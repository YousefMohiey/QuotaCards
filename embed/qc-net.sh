#!/bin/bash
# qc-net.sh — one-shot network upgrade for the QuotaCards VPS (Oracle A1, Ubuntu).
# Adds beside the existing Xray TCP/443:
#   * sing-box with a Hysteria2 inbound on UDP 443 (game mode, SNI preserved)
#   * WireGuard wg0 10.8.0.0/24 on UDP 51820 (raw mode, no SNI, no packages)
#   * helper CLIs + qc-agent v2 (new restricted commands for the app key)
# Idempotent: safe to re-run. Run as the ssh user (ubuntu) with passwordless sudo.
# AFTER this: open UDP 443 and UDP 51820 in the Oracle cloud security list.
set -e
WG_PORT=51820
HY2_PORT=443
WG_NET="10.8.0.0/24"
WG_IP="10.8.0.1"

need() { command -v "$1" >/dev/null 2>&1 || sudo apt-get install -y -qq "$1" >/dev/null 2>&1 || true; }
need curl; need python3; need iptables

echo "== sing-box (hysteria2) =="
if ! command -v sing-box >/dev/null 2>&1 && [ ! -x /usr/local/bin/sing-box ]; then
  cd /tmp
  API=$(curl -sL https://api.github.com/repos/SagerNet/sing-box/releases/latest)
  URL=$(echo "$API" | grep -oE 'https://[^"]*sing-box-[0-9.]+-linux-arm64\.tar\.gz' | head -1)
  curl -sL -o sb.tgz "$URL" && tar xzf sb.tgz
  sudo cp sing-box-*/sing-box /usr/local/bin/sing-box && sudo chmod +x /usr/local/bin/sing-box
fi
sudo mkdir -p /usr/local/etc/sing-box
if [ ! -f /usr/local/etc/qc-hy2pass ]; then
  python3 -c 'import secrets;print(secrets.token_hex(16))' | sudo tee /usr/local/etc/qc-hy2pass >/dev/null
  sudo chmod 600 /usr/local/etc/qc-hy2pass
fi
HYPASS=$(sudo cat /usr/local/etc/qc-hy2pass)
CRT=/usr/local/etc/xray/server.crt; KEY=/usr/local/etc/xray/server.key
sudo tee /usr/local/etc/sing-box/config.json >/dev/null <<JSON
{
  "log": {"level": "warning"},
  "inbounds": [{
    "type": "hysteria2", "tag": "hy2-in",
    "listen": "::", "listen_port": $HY2_PORT,
    "users": [{"name": "qc", "password": "$HYPASS"}],
    "ignore_client_bandwidth": true,
    "tls": {"enabled": true, "certificate_path": "$CRT", "key_path": "$KEY"}
  }],
  "outbounds": [{"type": "direct", "tag": "direct"}]
}
JSON
sudo tee /etc/systemd/system/sing-box.service >/dev/null <<'UNIT'
[Unit]
Description=sing-box Hysteria2
After=network.target
[Service]
ExecStart=/usr/local/bin/sing-box run -c /usr/local/etc/sing-box/config.json
Restart=on-failure
RestartSec=3
User=root
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable sing-box >/dev/null 2>&1 || true
sudo systemctl restart sing-box || true

echo "== wireguard =="
sudo apt-get install -y -qq wireguard-tools >/dev/null 2>&1 || true
sudo mkdir -p /etc/wireguard && sudo chmod 700 /etc/wireguard
if [ ! -f /etc/wireguard/qc-server.key ]; then
  sudo sh -c 'umask 077 && wg genkey | tee /etc/wireguard/qc-server.key | wg pubkey > /etc/wireguard/qc-server.pub'
fi
if [ ! -f /etc/wireguard/qc-peers.json ]; then
  echo '{"next": 2, "peers": {}}' | sudo tee /etc/wireguard/qc-peers.json >/dev/null
fi
sudo tee /usr/local/bin/qc-wg-apply >/dev/null <<SH
#!/bin/bash
# (re)create wg0, NAT, peers from registry. Called by systemd and qc-wg-add/del.
set -e
ip link del wg0 2>/dev/null || true
ip link add wg0 type wireguard
ip addr add $WG_IP/24 dev wg0
wg set wg0 listen-port $WG_PORT private-key /etc/wireguard/qc-server.key
sysctl -w net.ipv4.ip_forward=1 >/dev/null
iptables -t nat -C PREROUTING -p udp --dport 53 -j REDIRECT --to-port 51820 2>/dev/null || iptables -t nat -A PREROUTING -p udp --dport 53 -j REDIRECT --to-port 51820
iptables -C INPUT -p udp --dport 53 -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p udp --dport 53 -j ACCEPT
iptables -C FORWARD -i wg0 -j ACCEPT 2>/dev/null || iptables -I FORWARD 1 -i wg0 -j ACCEPT
iptables -C FORWARD -o wg0 -j ACCEPT 2>/dev/null || iptables -I FORWARD 1 -o wg0 -j ACCEPT
iptables -t nat -C POSTROUTING -s $WG_NET -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s $WG_NET -j MASQUERADE
python3 - <<'PY'
import json, subprocess
reg = json.load(open("/etc/wireguard/qc-peers.json"))
for u, p in reg.get("peers", {}).items():
    subprocess.run(["wg", "set", "wg0", "peer", p["pub"], "allowed-ips", p["ip"] + "/32"], check=False)
PY
ip link set wg0 up
SH
sudo chmod +x /usr/local/bin/qc-wg-apply
sudo tee /etc/systemd/system/qc-wg.service >/dev/null <<'UNIT'
[Unit]
Description=QuotaCards WireGuard
After=network.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/qc-wg-apply
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable qc-wg >/dev/null 2>&1 || true
sudo systemctl restart qc-wg || true

echo "== helper CLIs =="
sudo tee /usr/local/bin/qc-hy2-pass >/dev/null <<'SH'
#!/bin/bash
cat /usr/local/etc/qc-hy2pass
SH
sudo tee /usr/local/bin/qc-list >/dev/null <<'SH'
#!/bin/bash
python3 -c '
import json
try:
    cfg = json.load(open("/usr/local/etc/xray/config.json"))
except Exception:
    raise SystemExit(0)
for ib in cfg.get("inbounds", []):
    if ib.get("protocol") == "vless":
        for c in ib["settings"]["clients"]:
            print(c["id"])
' 2>/dev/null
SH
sudo tee /usr/local/bin/qc-wg-pub >/dev/null <<'SH'
#!/bin/bash
cat /etc/wireguard/qc-server.pub
SH
sudo tee /usr/local/bin/qc-wg-add >/dev/null <<'SH'
#!/bin/bash
# usage: qc-wg-add <uuid> -> JSON creds on stdout
set -e
u="$1"
exec sudo /usr/bin/python3 - "$u" <<'PY'
import json, subprocess, sys
u = sys.argv[1]
regp = "/etc/wireguard/qc-peers.json"
reg = json.load(open(regp))
p = reg["peers"].get(u)
if not p:
    priv = subprocess.run(["wg", "genkey"], capture_output=True, text=True, check=True).stdout.strip()
    pub = subprocess.run(["wg", "pubkey"], input=priv, capture_output=True, text=True, check=True).stdout.strip()
    ip = "10.8.0.%d" % reg["next"]
    reg["next"] += 1
    p = {"priv": priv, "pub": pub, "ip": ip}
    reg["peers"][u] = p
    json.dump(reg, open(regp, "w"), indent=2)
    subprocess.run(["wg", "set", "wg0", "peer", p["pub"], "allowed-ips", p["ip"] + "/32"], check=False)
srv = open("/etc/wireguard/qc-server.pub").read().strip()
print(json.dumps({"private_key": p["priv"], "address": p["ip"] + "/32", "server_pub": srv}))
PY
SH
sudo tee /usr/local/bin/qc-wg-del >/dev/null <<'SH'
#!/bin/bash
# usage: qc-wg-del <uuid>
set -e
u="$1"
sudo /usr/bin/python3 - "$u" <<'PY'
import json, subprocess, sys
u = sys.argv[1]
regp = "/etc/wireguard/qc-peers.json"
reg = json.load(open(regp))
p = reg["peers"].pop(u, None)
json.dump(reg, open(regp, "w"), indent=2)
if p:
    subprocess.run(["wg", "set", "wg0", "peer", p["pub"], "remove"], check=False)
    print("REMOVED")
else:
    print("ABSENT")
PY
SH
sudo chmod +x /usr/local/bin/qc-hy2-pass /usr/local/bin/qc-list /usr/local/bin/qc-wg-pub /usr/local/bin/qc-wg-add /usr/local/bin/qc-wg-del

echo "== firewall =="
sudo iptables -C INPUT -p udp --dport $HY2_PORT -j ACCEPT 2>/dev/null || \
  sudo iptables -I INPUT 5 -p udp --dport $HY2_PORT -j ACCEPT
sudo iptables -C INPUT -p udp --dport $WG_PORT -j ACCEPT 2>/dev/null || \
  sudo iptables -I INPUT 5 -p udp --dport $WG_PORT -j ACCEPT
sudo netfilter-persistent save >/dev/null 2>&1 || true

echo "== agent v2 =="
sudo cp /usr/local/bin/qc-agent /usr/local/bin/qc-agent.bak 2>/dev/null || true
sudo tee /usr/local/bin/qc-agent >/dev/null <<'AGENT'
#!/bin/bash
# qc-agent v2 — restricted forced command for the QuotaCards embedded key.
# Allowed: qc-add / qc-revoke (xray uuids), qc-hy2-pass, qc-wg-pub (no arg),
# qc-wg-add / qc-wg-del (uuid arg). Everything else is rejected.
set -u
cmd="${SSH_ORIGINAL_COMMAND:-}"
op="${cmd%% *}"
arg="${cmd#* }"
has_arg=0
case "$cmd" in *" "*) has_arg=1;; esac
case "$op" in
  qc-add|qc-revoke|qc-wg-add|qc-wg-del)
    [ "$has_arg" = "1" ] || { echo denied; exit 1; }
    case "$arg" in
      ????????-????-????-????-????????????) ;;
      *) echo "bad id"; exit 1;;
    esac
    case "$arg" in
      *[!0-9a-fA-F-]*) echo "bad id"; exit 1;;
    esac
    ;;
  qc-hy2-pass|qc-wg-pub|qc-list)
    [ "$has_arg" = "0" ] || { echo denied; exit 1; }
    ;;
  *) echo denied; exit 1;;
esac
if [ "$op" = "qc-add" ]; then
  sudo /usr/bin/python3 - "$arg" <<'PYEOF'
import json,sys
p="/usr/local/etc/xray/config.json"
u=sys.argv[1]
cfg=json.load(open(p))
for ib in cfg.get("inbounds",[]):
    if ib.get("protocol")=="vless":
        cs=ib["settings"]["clients"]
        if u not in [c["id"] for c in cs]:
            cs.append({"id":u,"flow":""})
            json.dump(cfg,open(p,"w"),indent=2)
            print("ADDED")
        else:
            print("EXISTS")
PYEOF
elif [ "$op" = "qc-revoke" ]; then
  sudo /usr/bin/python3 - "$arg" <<'PYEOF'
import json,sys
p="/usr/local/etc/xray/config.json"
u=sys.argv[1]
cfg=json.load(open(p))
for ib in cfg.get("inbounds",[]):
    if ib.get("protocol")=="vless":
        ib["settings"]["clients"]=[c for c in ib["settings"]["clients"] if c["id"]!=u]
json.dump(cfg,open(p,"w"),indent=2)
print("REMOVED")
PYEOF
elif [ "$op" = "qc-hy2-pass" ]; then
  sudo /usr/local/bin/qc-hy2-pass
elif [ "$op" = "qc-list" ]; then
  sudo /usr/local/bin/qc-list
elif [ "$op" = "qc-wg-pub" ]; then
  sudo /usr/local/bin/qc-wg-pub
elif [ "$op" = "qc-wg-add" ]; then
  sudo /usr/local/bin/qc-wg-add "$arg"
elif [ "$op" = "qc-wg-del" ]; then
  sudo /usr/local/bin/qc-wg-del "$arg"
fi
[ "$op" = "qc-add" ] || [ "$op" = "qc-revoke" ] && sudo /bin/systemctl restart xray
echo OK
AGENT
sudo chmod +x /usr/local/bin/qc-agent
if grep -q 'command=.*qc-agent' ~/.ssh/authorized_keys 2>/dev/null; then
  echo "(authorized_keys already points at a qc-agent, verify it runs /usr/local/bin/qc-agent)"
else
  echo "NOTE: no forced-command qc-agent line found in ~/.ssh/authorized_keys - point it at /usr/local/bin/qc-agent"
fi

echo QC_NET_READY
echo "hy2 udp/$HY2_PORT + wg udp/$WG_PORT live. Open both UDP ports in the Oracle security list."

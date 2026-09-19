/// High-level server operations - everything the app does against the VPS.
/// SSH details stay inside this module; the UI never sees commands.
use crate::ssh::SshSession;

/// Scripts run remotely (kept here so the UI stays clean).

/// Check if Xray is installed; if not, install it (arm64 Linux, the Oracle A1 shape).
/// Also ensures config.json exists and TCP 443 is open in the server firewall.
pub const INSTALL_XRAY: &str = r#"set -e
if ! command -v xray >/dev/null 2>&1 && [ ! -x /usr/local/bin/xray ]; then
  # install xray arm64
  cd /tmp
  API=$(curl -sL https://api.github.com/repos/XTLS/Xray-core/releases/latest)
  URL=$(echo "$API" | grep -oE 'https://[^"]*Xray-linux-arm64-v8a.zip' | head -1)
  curl -sL -o xray.zip "$URL"
  sudo apt-get install -y -qq unzip >/dev/null 2>&1 || true
  mkdir -p xray_dir && unzip -o -q xray.zip -d xray_dir
  sudo mkdir -p /usr/local/bin /usr/local/etc/xray
  sudo cp xray_dir/xray /usr/local/bin/xray
  sudo chmod +x /usr/local/bin/xray
  # TLS self-signed cert (CN just needs to exist - clients pin nothing)
  cd /tmp
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
    -keyout server.key -out server.crt -days 3650 -subj "/CN=ea.com" 2>/dev/null
  sudo mv server.key server.crt /usr/local/etc/xray/
  # firewall: allow TCP 443 inbound
  sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || \
    sudo iptables -I INPUT 5 -p tcp --dport 443 -j ACCEPT
  sudo apt-get install -y -qq iptables-persistent >/dev/null 2>&1 || true
  sudo netfilter-persistent save >/dev/null 2>&1 || true
fi
# ensure config.json exists with our clients (idempotent merge)
sudo python3 - <<'PY'
import json, os
p = "/usr/local/etc/xray/config.json"
cfg = {
  "inbounds": [{
    "port": 443, "protocol": "vless",
    "settings": {"clients": [], "decryption": "none"},
    "streamSettings": {
      "network": "tcp", "security": "tls",
      "tlsSettings": {"certificates": [{
        "certificateFile": "/usr/local/etc/xray/server.crt",
        "keyFile": "/usr/local/etc/xray/server.key"}]}
    }
  }],
  "outbounds": [{"protocol": "freedom", "tag": "direct"}]
}
if os.path.exists(p):
    try:
        cfg = json.load(open(p))
    except Exception:
        pass
# normalize: ensure inbound structure present
if not cfg.get("inbounds"):
    cfg["inbounds"] = [cfg.pop("inbound", None)] if cfg.get("inbound") else []
for ib in cfg.get("inbounds", []):
    if ib.get("protocol") == "vless":
        ib.setdefault("settings", {}).setdefault("clients", [])
        break
else:
    cfg["inbounds"].append({
        "port": 443, "protocol": "vless",
        "settings": {"clients": [], "decryption": "none"},
        "streamSettings": {
          "network": "tcp", "security": "tls",
          "tlsSettings": {"certificates": [{
            "certificateFile": "/usr/local/etc/xray/server.crt",
            "keyFile": "/usr/local/etc/xray/server.key"}]}
        }})
json.dump(cfg, open(p, "w"), indent=2)
PY
# systemd service
sudo tee /etc/systemd/system/xray.service >/dev/null <<'UNIT'
[Unit]
Description=Xray VLESS Proxy
After=network.target
[Service]
ExecStart=/usr/local/bin/xray run -config /usr/local/etc/xray/config.json
Restart=on-failure
RestartSec=3
User=root
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable xray >/dev/null 2>&1 || true
sudo systemctl restart xray || true
sleep 1
echo XRAY_READY"#;

const ADD_CLIENT: &str = r#"
set -e
exec sudo python3 - <<'PY'
import json
p = "/usr/local/etc/xray/config.json"
cfg = json.load(open(p))
uuidv = "Q_C_UUID_HERE"
clients = None
for ib in cfg.get("inbounds", []):
    if ib.get("protocol") == "vless":
        clients = ib["settings"]["clients"]
        break
if clients is None:
    sys.exit("no vless inbound")
ids = [c["id"] for c in clients]
if uuidv not in ids:
    clients.append({"id": uuidv, "flow": ""})
    json.dump(cfg, open(p, "w"), indent=2)
    print("ADDED")
else:
    print("EXISTS")
PY
sudo systemctl restart xray
echo OK"#;

const REMOVE_CLIENT: &str = r#"
set -e
exec sudo python3 - <<'PY'
import json
p = "/usr/local/etc/xray/config.json"
cfg = json.load(open(p))
rm = "Q_C_UUID_HERE"
for ib in cfg.get("inbounds", []):
    if ib.get("protocol") == "vless":
        ib["settings"]["clients"] = [c for c in ib["settings"]["clients"] if c["id"] != rm]
json.dump(cfg, open(p, "w"), indent=2)
print("REMOVED")
PY
sudo systemctl restart xray
echo OK"#;

const LIST_CLIENTS: &str = r#"
exec python3 -c '
import json
try:
    cfg = json.load(open("/usr/local/etc/xray/config.json"))
except Exception:
    print("NO_CONFIG"); raise SystemExit(0)
for ib in cfg.get("inbounds", []):
    if ib.get("protocol") == "vless":
        for c in ib["settings"]["clients"]:
            print(c["id"])
' 2>/dev/null"#;

pub async fn run_cmd(host: &str, port: u16, user: &str, key: &str, script: &str) -> Result<String, String> {
    let mut s = SshSession::connect(host, port, user, key).await?;
    s.exec(script).await
}

pub async fn ensure_xray(host: &str, port: u16, user: &str, key: &str) -> Result<String, String> {
    // merge new UUIDs into the config if the user already has clients
    run_cmd(host, port, user, key, INSTALL_XRAY).await
}

/// True when `key` is the baked-in device key → restricted qc-agent protocol
/// (register/revoke only, no shell) instead of the full setup scripts.
pub fn is_embed_key(key: &str) -> bool {
    crate::config::EMBED_KEY.map_or(false, |e| e == key)
}

fn valid_uuid(u: &str) -> bool {
    u.len() == 36 && u.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
}

pub async fn add_client(host: &str, port: u16, user: &str, key: &str, uuidv: &str) -> Result<String, String> {
    if is_embed_key(key) {
        if !valid_uuid(uuidv) {
            return Err("bad id".to_string());
        }
        return run_cmd(host, port, user, key, &format!("qc-add {uuidv}")).await;
    }
    let script = ADD_CLIENT.replace("Q_C_UUID_HERE", uuidv);
    run_cmd(host, port, user, key, &script).await
}

pub async fn remove_client(host: &str, port: u16, user: &str, key: &str, uuidv: &str) -> Result<String, String> {
    if is_embed_key(key) {
        if !valid_uuid(uuidv) {
            return Err("bad id".to_string());
        }
        return run_cmd(host, port, user, key, &format!("qc-revoke {uuidv}")).await;
    }
    let script = REMOVE_CLIENT.replace("Q_C_UUID_HERE", uuidv);
    run_cmd(host, port, user, key, &script).await
}

pub async fn list_clients(host: &str, port: u16, user: &str, key: &str) -> Result<Vec<String>, String> {
    let out = if is_embed_key(key) {
        run_cmd(host, port, user, key, "qc-list").await?
    } else {
        run_cmd(host, port, user, key, LIST_CLIENTS).await?
    };
    Ok(out
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && l != "[exit 0]" && !l.starts_with("NO_CONFIG"))
        .collect())
}

/// Upgrade script lives in embed/qc-net.sh (baked into the binary).
const NET_SCRIPT: &str = include_str!("../embed/qc-net.sh");

/// Error shown when the VPS predates the multi-transport upgrade.
fn need_upgrade() -> String {
    "server needs the network upgrade - run embed/qc-net.sh on the VPS once".to_string()
}

fn shell_out(out: &str) -> Result<String, String> {
    if out.contains("denied") || out.contains("No such file") {
        return Err(need_upgrade());
    }
    Ok(out.to_string())
}

/// Full-shell keys run the upgrade script directly. Restricted (embed) keys
/// cannot install anything - Yousef runs the script once, the app uses the
/// agent commands after that.
pub async fn ensure_net(host: &str, port: u16, user: &str, key: &str) -> Result<String, String> {
    if is_embed_key(key) {
        // readiness probe: old agents deny this command
        run_cmd(host, port, user, key, "qc-hy2-pass").await.and_then(|o| shell_out(&o))?;
        return Ok("NET_READY (agent)".to_string());
    }
    run_cmd(host, port, user, key, NET_SCRIPT).await
}

async fn net_cmd(host: &str, port: u16, user: &str, key: &str, agent: &str, shell: &str) -> Result<String, String> {
    let out = if is_embed_key(key) {
        run_cmd(host, port, user, key, agent).await?
    } else {
        run_cmd(host, port, user, key, shell).await?
    };
    shell_out(&out)
}

fn clean_line(out: &str) -> Result<String, String> {
    out.lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty() && *l != "[exit 0]" && *l != "OK")
        .map(|l| l.to_string())
        .ok_or_else(need_upgrade)
}

/// The JSON object inside a command's output, whatever its shape: compact on
/// one line, pretty-printed across lines, or followed by the agent's OK
/// trailer. Taking "the first line" is what once cached a bare "{".
fn clean_json(out: &str) -> Result<String, String> {
    let start = out.find('{').ok_or_else(need_upgrade)?;
    let end = out.rfind('}').ok_or_else(need_upgrade)?;
    if end <= start {
        return Err(need_upgrade());
    }
    Ok(out[start..=end].to_string())
}

/// Shared Hysteria2 password (one per server, no per-user step needed).
pub async fn hy2_password(host: &str, port: u16, user: &str, key: &str) -> Result<String, String> {
    let out = net_cmd(host, port, user, key, "qc-hy2-pass", "sudo /usr/local/bin/qc-hy2-pass").await?;
    clean_line(&out)
}

/// AmneziaWG obfuscation parameters (one set per server, shared by all cards).
pub async fn awg_params(host: &str, port: u16, user: &str, key: &str) -> Result<String, String> {
    let out = net_cmd(host, port, user, key, "qc-awg-params", "sudo /usr/local/bin/qc-awg-params").await?;
    let j = clean_json(&out)?;
    // Only a value that parses is worth carrying into the config.
    serde_json::from_str::<serde_json::Value>(&j).map_err(|_| need_upgrade())?;
    Ok(j)
}

/// WireGuard server public key (one per server).
pub async fn wg_server_pub(host: &str, port: u16, user: &str, key: &str) -> Result<String, String> {
    let out = net_cmd(host, port, user, key, "qc-wg-pub", "sudo /usr/local/bin/qc-wg-pub").await?;
    let line = clean_line(&out)?;
    if line.len() < 40 {
        return Err(need_upgrade());
    }
    Ok(line)
}

#[derive(serde::Deserialize)]
pub struct WgCreds {
    pub private_key: String,
    pub address: String,
    pub server_pub: String,
}

/// Register this card on the server WireGuard and return its credentials.
/// Idempotent: re-adding the same uuid returns the existing credentials.
pub async fn wg_add(host: &str, port: u16, user: &str, key: &str, uuidv: &str) -> Result<WgCreds, String> {
    if !valid_uuid(uuidv) {
        return Err("bad id".to_string());
    }
    let out = net_cmd(
        host, port, user, key,
        &format!("qc-wg-add {uuidv}"),
        &format!("sudo /usr/local/bin/qc-wg-add {uuidv}"),
    )
    .await?;
    let line = out
        .lines()
        .map(|l| l.trim())
        .find(|l| l.starts_with('{'))
        .ok_or_else(need_upgrade)?;
    serde_json::from_str(line).map_err(|e| format!("wg setup: {e}"))
}

/// Remove a card's WireGuard peer. Best effort: never fails the caller.
pub async fn wg_del(host: &str, port: u16, user: &str, key: &str, uuidv: &str) {
    if !valid_uuid(uuidv) {
        return;
    }
    let _ = net_cmd(
        host, port, user, key,
        &format!("qc-wg-del {uuidv}"),
        &format!("sudo /usr/local/bin/qc-wg-del {uuidv}"),
    )
    .await;
}
#[cfg(test)]
mod awg_json_tests {
    use super::*;

    #[test]
    fn extraction_survives_pretty_json_and_trailers() {
        let pretty = "{\n  \"jc\": 4,\n  \"jmin\": 40\n}\nOK\n";
        assert_eq!(clean_json(pretty).unwrap(), "{\n  \"jc\": 4,\n  \"jmin\": 40\n}");
        let compact = "{\"jc\":4}\nOK\n";
        assert_eq!(clean_json(compact).unwrap(), "{\"jc\":4}");
        assert!(clean_json("no json here").is_err());
    }
}

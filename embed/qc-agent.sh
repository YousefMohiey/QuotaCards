#!/bin/bash
# qc-agent — restricted forced command for the QuotaCards embedded key.
# This key can ONLY register/revoke single client UUIDs. No shell, no install,
# no file access beyond the Xray client list. Anything else is rejected.
set -u
cmd="${SSH_ORIGINAL_COMMAND:-}"
op="${cmd%% *}"
uuid="${cmd#* }"
case "$cmd" in
  *" "*) ;;
  *) echo "denied"; exit 1;;
esac
if [ "$op" != "qc-add" ] && [ "$op" != "qc-revoke" ]; then
  echo "denied"; exit 1
fi
case "$uuid" in
  ????????-????-????-????-????????????) ;;
  *) echo "bad id"; exit 1;;
esac
# hex/dash characters only (no shell metachars can survive here)
case "$uuid" in
  *[!0-9a-fA-F-]*) echo "bad id"; exit 1;;
esac
if [ "$op" = "qc-add" ]; then
  sudo /usr/bin/python3 - "$uuid" <<'PYEOF'
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
else
  sudo /usr/bin/python3 - "$uuid" <<'PYEOF'
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
fi
sudo /bin/systemctl restart xray
echo OK

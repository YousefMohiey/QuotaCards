# Put the demo bridge ahead of app.js in the site's copy of the phone UI.
# The APK's own index.html never carries this line.
import io, sys
p = sys.argv[1]
t = io.open(p, encoding="utf-8", newline="").read()
line = '<script src="demo-bridge.js"></script>\n'
if "demo-bridge.js" not in t:
    t = t.replace('<script src="app.js" defer></script>', line + '<script src="app.js" defer></script>', 1)
    io.open(p, "w", encoding="utf-8", newline="").write(t)
    print("bridge re-injected")
else:
    print("bridge already present")

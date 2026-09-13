// Forwarder for the Gradle BuildTask (`node tauri android android-studio-script`).
// Hands off to the real @tauri-apps/cli entrypoint.
import { createRequire } from 'module';
import path from 'path';
const require2 = createRequire(import.meta.url);
const cliDir = 'C:/Tools/QuotaCards/android/tauri-cli-npm/node_modules/@tauri-apps/cli';
process.argv[1] = path.join(cliDir, 'tauri.js');
require2(path.join(cliDir, 'tauri.js'));

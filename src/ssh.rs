/// SSH plumbing built on russh (pure-Rust SSH - works on any Windows box
/// without OpenSSH or any external binary).
use russh::client::{self, Handler};
use russh::keys::PrivateKeyWithHashAlg;
use russh::ChannelMsg;
use std::sync::Arc;

#[derive(Clone)]
pub struct ClientHandler;

impl Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

pub struct SshSession {
    session: russh::client::Handle<ClientHandler>,
}

impl SshSession {
    /// Connect + authenticate with a PEM private key.
    pub async fn connect(
        host: &str,
        port: u16,
        user: &str,
        private_key_pem: &str,
    ) -> Result<SshSession, String> {
        let config = Arc::new(client::Config::default());
        // No timeout here hangs forever on networks that drop the port
        // (common for SSH/22 on mobile carriers) - fail fast instead.
        let mut session = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            client::connect(config, (host, port), ClientHandler),
        )
        .await
        .map_err(|_| {
            format!("connect timed out - {host}:{port} unreachable (port may be blocked on this network)")
        })
        .and_then(|r| r.map_err(|e| format!("connect: {e}")))?;

        let key = russh::keys::decode_secret_key(private_key_pem, None)
            .map_err(|e| format!("key: {e}"))?;
        let pk = PrivateKeyWithHashAlg::new(Arc::new(key), None);

        let auth = tokio::time::timeout(
            std::time::Duration::from_secs(20),
            session.authenticate_publickey(user, pk),
        )
        .await
        .map_err(|_| "auth timed out".to_string())
        .and_then(|r| r.map_err(|e| format!("auth: {e}")))?;
        if !auth.success() {
            return Err("authentication failed (key not accepted)".into());
        }

        Ok(SshSession { session })
    }

    /// Run a remote command, capture combined output.
    pub async fn exec(&mut self, cmd: &str) -> Result<String, String> {
        let mut channel = self
            .session
            .channel_open_session()
            .await
            .map_err(|e| format!("channel: {e}"))?;

        channel
            .exec(true, cmd)
            .await
            .map_err(|e| format!("exec: {e}"))?;

        let mut out = String::new();
        loop {
            let msg = channel.wait().await;
            let Some(msg) = msg else { break };
            match msg {
                ChannelMsg::Data { ref data } => {
                    out.push_str(&String::from_utf8_lossy(data));
                }
                ChannelMsg::ExtendedData { ref data, .. } => {
                    out.push_str(&String::from_utf8_lossy(data));
                }
                ChannelMsg::Eof | ChannelMsg::Close => break,
                ChannelMsg::ExitStatus { exit_status } => {
                    out.push_str(&format!("\n[exit {exit_status}]"));
                    break;
                }
                _ => {}
            }
        }
        let _ = channel.close().await;
        Ok(out)
    }
}
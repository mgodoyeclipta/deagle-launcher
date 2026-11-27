//! Discord Rich Presence: shows "Counter-Strike 1.6 · de_dust2 · Server" on
//! the user's Discord profile while the game runs.
//!
//! Talks to the local Discord app over IPC; nothing is sent anywhere else.
//! If Discord isn't running every call quietly does nothing.

use discord_rich_presence::activity::{Activity, Assets, Button, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use std::sync::Mutex;

/// Application ID from https://discord.com/developers/applications
/// (the app's name is what Discord shows as "Playing …"). It is public, not a
/// secret. Empty = Rich Presence disabled.
pub const CLIENT_ID: &str = "";

/// Asset key of the large image uploaded under Rich Presence → Art Assets.
const LARGE_IMAGE: &str = "logo";
const REPO_URL: &str = "https://github.com/mgodoyeclipta/deagle-launcher";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    pub details: String,
    pub state: Option<String>,
    /// Unix milliseconds when the session started (shows "elapsed").
    pub started_at: Option<i64>,
}

#[derive(Default)]
pub struct DiscordState {
    client: Mutex<Option<DiscordIpcClient>>,
}

pub fn is_configured() -> bool {
    !CLIENT_ID.is_empty()
}

/// Discord limits details/state to 128 characters.
fn clip(text: &str) -> String {
    text.chars().take(128).collect()
}

impl DiscordState {
    fn with_client<T>(
        &self,
        f: impl Fn(&mut DiscordIpcClient) -> Result<T, discord_rich_presence::error::Error>,
    ) -> Result<T, String> {
        if !is_configured() {
            return Err("Discord no está configurado".into());
        }
        let mut guard = self.client.lock().unwrap();
        // A stale connection (Discord restarted) fails once; reconnect and retry.
        for _ in 0..2 {
            if guard.is_none() {
                let mut client = DiscordIpcClient::new(CLIENT_ID);
                client.connect().map_err(|e| e.to_string())?;
                *guard = Some(client);
            }
            match f(guard.as_mut().unwrap()) {
                Ok(v) => return Ok(v),
                Err(_) => {
                    if let Some(mut old) = guard.take() {
                        let _ = old.close();
                    }
                }
            }
        }
        Err("No se pudo hablar con Discord".into())
    }

    pub fn set(&self, presence: &Presence) -> Result<(), String> {
        let details = clip(&presence.details);
        let state = presence.state.as_deref().map(clip);
        self.with_client(|client| {
            let mut activity = Activity::new()
                .details(details.as_str())
                .assets(Assets::new().large_image(LARGE_IMAGE).large_text("Deagle Launcher"))
                .buttons(vec![Button::new("Deagle Launcher", REPO_URL)]);
            if let Some(state) = &state {
                activity = activity.state(state.as_str());
            }
            if let Some(start) = presence.started_at {
                activity = activity.timestamps(Timestamps::new().start(start));
            }
            client.set_activity(activity)
        })
    }

    pub fn clear(&self) {
        let mut guard = self.client.lock().unwrap();
        if let Some(client) = guard.as_mut() {
            let _ = client.clear_activity();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clips_long_text() {
        assert_eq!(clip(&"x".repeat(200)).chars().count(), 128);
        assert_eq!(clip("de_dust2"), "de_dust2");
    }

    #[test]
    fn unconfigured_is_a_quiet_error() {
        if is_configured() {
            return;
        }
        let state = DiscordState::default();
        let presence = Presence { details: "x".into(), state: None, started_at: None };
        assert!(state.set(&presence).is_err());
        state.clear(); // must not panic
    }
}

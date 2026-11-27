//! Valve server queries (A2S) for GoldSrc / Counter-Strike 1.6 servers.
//!
//! Servers answer these UDP queries directly, so the launcher gets live
//! name, map, player counts and player lists without any third-party site.
//! Reference: https://developer.valvesoftware.com/wiki/Server_queries

use serde::Serialize;
use std::net::SocketAddr;
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;
use tokio::task::JoinSet;
use tokio::time::timeout;

const HEADER: [u8; 4] = [0xFF; 4];
const INFO_REQUEST: &[u8] = b"TSource Engine Query\0";
const TIMEOUT: Duration = Duration::from_millis(1500);
/// Upper bound on servers per request, to keep a single refresh reasonable.
pub const MAX_SERVERS: usize = 256;

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub name: String,
    pub map: String,
    pub folder: String,
    pub game: String,
    pub players: u8,
    pub max_players: u8,
    pub bots: u8,
    pub password: bool,
    pub vac: bool,
    pub ping_ms: u32,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub address: String,
    pub info: Option<ServerInfo>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerInfo {
    pub name: String,
    pub score: i32,
    pub duration_secs: u32,
}

// ---------------------------------------------------------------------------
// Packet parsing
// ---------------------------------------------------------------------------

struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(data: &'a [u8], pos: usize) -> Self {
        Self { data, pos }
    }

    fn u8(&mut self) -> Option<u8> {
        let v = *self.data.get(self.pos)?;
        self.pos += 1;
        Some(v)
    }

    fn bytes<const N: usize>(&mut self) -> Option<[u8; N]> {
        let slice = self.data.get(self.pos..self.pos + N)?;
        self.pos += N;
        slice.try_into().ok()
    }

    fn i16(&mut self) -> Option<i16> {
        self.bytes::<2>().map(i16::from_le_bytes)
    }

    fn i32(&mut self) -> Option<i32> {
        self.bytes::<4>().map(i32::from_le_bytes)
    }

    fn f32(&mut self) -> Option<f32> {
        self.bytes::<4>().map(f32::from_le_bytes)
    }

    /// NUL-terminated string. Server names are not always UTF-8.
    fn cstr(&mut self) -> Option<String> {
        let rest = self.data.get(self.pos..)?;
        let end = rest.iter().position(|&b| b == 0)?;
        self.pos += end + 1;
        Some(String::from_utf8_lossy(&rest[..end]).into_owned())
    }
}

/// What a reply to A2S_INFO turned out to be.
#[derive(Debug, PartialEq)]
enum InfoReply {
    Challenge([u8; 4]),
    Info(ServerInfo),
}

/// Parses an A2S_INFO reply: a challenge, the Source-style `I` answer that
/// updated HLDS servers send, or the legacy GoldSrc `m` answer.
fn parse_info(packet: &[u8], ping_ms: u32) -> Option<InfoReply> {
    if packet.get(..4)? != HEADER {
        return None; // split packets (0xFFFFFFFE) never happen for info replies in practice
    }
    let mut r = Reader::new(packet, 5);
    match packet[4] {
        b'A' => Some(InfoReply::Challenge(r.bytes::<4>()?)),
        b'I' => {
            let _protocol = r.u8()?;
            let name = r.cstr()?;
            let map = r.cstr()?;
            let folder = r.cstr()?;
            let game = r.cstr()?;
            let _app_id = r.i16()?;
            let players = r.u8()?;
            let max_players = r.u8()?;
            let bots = r.u8()?;
            let _server_type = r.u8()?;
            let _environment = r.u8()?;
            let password = r.u8()? == 1;
            let vac = r.u8()? == 1;
            Some(InfoReply::Info(ServerInfo {
                name,
                map,
                folder,
                game,
                players,
                max_players,
                bots,
                password,
                vac,
                ping_ms,
            }))
        }
        b'm' => {
            let _address = r.cstr()?;
            let name = r.cstr()?;
            let map = r.cstr()?;
            let folder = r.cstr()?;
            let game = r.cstr()?;
            let players = r.u8()?;
            let max_players = r.u8()?;
            let _protocol = r.u8()?;
            let _server_type = r.u8()?;
            let _environment = r.u8()?;
            let password = r.u8()? == 1;
            let is_mod = r.u8()? == 1;
            if is_mod {
                let _link = r.cstr()?;
                let _download = r.cstr()?;
                let _null = r.u8()?;
                let _version = r.i32()?;
                let _size = r.i32()?;
                let _mod_type = r.u8()?;
                let _dll = r.u8()?;
            }
            // Some servers stop here; treat missing trailing fields as zero.
            let vac = r.u8().unwrap_or(0) == 1;
            let bots = r.u8().unwrap_or(0);
            Some(InfoReply::Info(ServerInfo {
                name,
                map,
                folder,
                game,
                players,
                max_players,
                bots,
                password,
                vac,
                ping_ms,
            }))
        }
        _ => None,
    }
}

#[derive(Debug, PartialEq)]
enum PlayersReply {
    Challenge([u8; 4]),
    Players(Vec<PlayerInfo>),
}

fn parse_players(packet: &[u8]) -> Option<PlayersReply> {
    if packet.get(..4)? != HEADER {
        return None;
    }
    let mut r = Reader::new(packet, 5);
    match packet[4] {
        b'A' => Some(PlayersReply::Challenge(r.bytes::<4>()?)),
        b'D' => {
            let count = r.u8()?;
            let mut players = Vec::with_capacity(count as usize);
            for _ in 0..count {
                let _index = r.u8()?;
                let name = r.cstr()?;
                let score = r.i32()?;
                let duration = r.f32()?;
                players.push(PlayerInfo {
                    name,
                    score,
                    duration_secs: duration.max(0.0) as u32,
                });
            }
            Some(PlayersReply::Players(players))
        }
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

async fn resolve(address: &str) -> Result<SocketAddr, String> {
    tokio::net::lookup_host(address)
        .await
        .map_err(|e| format!("No se pudo resolver {address}: {e}"))?
        .find(SocketAddr::is_ipv4)
        .ok_or_else(|| format!("Sin dirección IPv4 para {address}"))
}

async fn connect(address: &str) -> Result<UdpSocket, String> {
    let target = resolve(address).await?;
    let socket = UdpSocket::bind("0.0.0.0:0").await.map_err(|e| e.to_string())?;
    socket.connect(target).await.map_err(|e| e.to_string())?;
    Ok(socket)
}

/// Sends `request` and waits for one reply, returning it with the round trip.
async fn exchange(socket: &UdpSocket, request: &[u8]) -> Result<(Vec<u8>, u32), String> {
    let start = Instant::now();
    socket.send(request).await.map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 4096];
    let len = timeout(TIMEOUT, socket.recv(&mut buf))
        .await
        .map_err(|_| "Sin respuesta".to_string())?
        .map_err(|e| e.to_string())?;
    buf.truncate(len);
    Ok((buf, start.elapsed().as_millis() as u32))
}

fn info_request(challenge: Option<[u8; 4]>) -> Vec<u8> {
    let mut req = HEADER.to_vec();
    req.extend_from_slice(INFO_REQUEST);
    if let Some(c) = challenge {
        req.extend_from_slice(&c);
    }
    req
}

pub async fn query_info(address: &str) -> Result<ServerInfo, String> {
    let socket = connect(address).await?;
    let mut challenge = None;
    // First try, then with the server's challenge (flood protection may renew it once).
    for _ in 0..3 {
        let (packet, ping) = exchange(&socket, &info_request(challenge)).await?;
        match parse_info(&packet, ping) {
            Some(InfoReply::Info(info)) => return Ok(info),
            Some(InfoReply::Challenge(c)) => challenge = Some(c),
            None => return Err("Respuesta inválida".into()),
        }
    }
    Err("El servidor no aceptó el desafío".into())
}

pub async fn query_players(address: &str) -> Result<Vec<PlayerInfo>, String> {
    let socket = connect(address).await?;
    let mut challenge = [0xFF; 4];
    // Servers with flood protection may hand out a fresh challenge once more.
    for _ in 0..3 {
        let mut req = HEADER.to_vec();
        req.push(b'U');
        req.extend_from_slice(&challenge);
        let (packet, _) = exchange(&socket, &req).await?;
        match parse_players(&packet) {
            Some(PlayersReply::Players(players)) => return Ok(players),
            Some(PlayersReply::Challenge(c)) => challenge = c,
            None => return Err("Respuesta inválida".into()),
        }
    }
    Err("El servidor no aceptó el desafío".into())
}

/// Queries every address in parallel. Results keep the input order.
pub async fn query_many(addresses: Vec<String>) -> Vec<ServerStatus> {
    let mut set = JoinSet::new();
    for (i, address) in addresses.iter().cloned().enumerate() {
        set.spawn(async move { (i, query_info(&address).await) });
    }
    let mut results: Vec<Option<Result<ServerInfo, String>>> = vec![None; addresses.len()];
    while let Some(joined) = set.join_next().await {
        if let Ok((i, result)) = joined {
            results[i] = Some(result);
        }
    }
    addresses
        .into_iter()
        .zip(results)
        .map(|(address, result)| match result {
            Some(Ok(info)) => ServerStatus { address, info: Some(info), error: None },
            Some(Err(e)) => ServerStatus { address, info: None, error: Some(e) },
            None => ServerStatus { address, info: None, error: Some("Error interno".into()) },
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packet(kind: u8, body: &[u8]) -> Vec<u8> {
        let mut p = HEADER.to_vec();
        p.push(kind);
        p.extend_from_slice(body);
        p
    }

    #[test]
    fn parses_challenge() {
        let p = packet(b'A', &[1, 2, 3, 4]);
        assert_eq!(parse_info(&p, 0), Some(InfoReply::Challenge([1, 2, 3, 4])));
        assert_eq!(parse_players(&p), Some(PlayersReply::Challenge([1, 2, 3, 4])));
    }

    #[test]
    fn parses_source_style_info() {
        let mut body = vec![48];
        body.extend_from_slice(b"[ARG] Server\0de_mirage\0cstrike\0Counter-Strike\0");
        body.extend_from_slice(&10i16.to_le_bytes());
        body.extend_from_slice(&[16, 32, 16, b'd', b'l', 0, 1]);
        body.extend_from_slice(b"1.1.2.7\0");
        let Some(InfoReply::Info(info)) = parse_info(&packet(b'I', &body), 61) else {
            panic!("expected info");
        };
        assert_eq!(info.name, "[ARG] Server");
        assert_eq!(info.map, "de_mirage");
        assert_eq!((info.players, info.max_players, info.bots), (16, 32, 16));
        assert!(!info.password && info.vac);
        assert_eq!(info.ping_ms, 61);
    }

    #[test]
    fn parses_legacy_goldsrc_info() {
        let mut body = b"45.235.98.52:27038\0PUBLICO III\0de_dust2\0cstrike\0Counter-Strike\0".to_vec();
        body.extend_from_slice(&[31, 32, 47, b'd', b'l', 1, 0, 1, 2]);
        let Some(InfoReply::Info(info)) = parse_info(&packet(b'm', &body), 31) else {
            panic!("expected info");
        };
        assert_eq!(info.name, "PUBLICO III");
        assert_eq!(info.map, "de_dust2");
        assert_eq!((info.players, info.max_players), (31, 32));
        assert!(info.password && info.vac);
        assert_eq!(info.bots, 2);
    }

    #[test]
    fn parses_players() {
        let mut body = vec![2];
        body.push(0);
        body.extend_from_slice(b"matiGOD\0");
        body.extend_from_slice(&15i32.to_le_bytes());
        body.extend_from_slice(&125.7f32.to_le_bytes());
        body.push(1);
        body.extend_from_slice(b"bot\0");
        body.extend_from_slice(&(-1i32).to_le_bytes());
        body.extend_from_slice(&3.0f32.to_le_bytes());
        let Some(PlayersReply::Players(players)) = parse_players(&packet(b'D', &body)) else {
            panic!("expected players");
        };
        assert_eq!(players.len(), 2);
        assert_eq!(players[0], PlayerInfo { name: "matiGOD".into(), score: 15, duration_secs: 125 });
        assert_eq!(players[1].score, -1);
    }

    /// Hits real servers; run with `cargo test -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_query() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let addrs = std::env::var("A2S_SERVERS").unwrap_or_else(|_| "45.235.98.52:27038,186.19.63.56:27015".into());
        let list: Vec<String> = addrs.split(',').map(String::from).collect();
        for status in rt.block_on(query_many(list.clone())) {
            println!("{status:?}");
        }
        println!("players: {:?}", rt.block_on(query_players(&list[0])).map(|p| p.len()));
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(parse_info(b"hello", 0), None);
        assert_eq!(parse_info(&packet(b'I', &[48, b'x']), 0), None); // truncated
        assert_eq!(parse_players(&[0xFE, 0xFF, 0xFF, 0xFF, b'D']), None);
    }
}

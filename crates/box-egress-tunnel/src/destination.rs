//! What the laptop end is willing to dial.
//!
//! The allowlist in [`crate::allowlist`] matches the CONNECT host *string*.
//! That is not a security boundary: the string is chosen by whatever is running
//! in the guest browser, and an empty list used to mean "allow everything",
//! which is the shipped default. Combined with a proxy that any page in the
//! guest can reach, that turned the operator's laptop into an open relay onto
//! their own home network -- `192.168.0.0/16`, `127.0.0.1`, `169.254.169.254`.
//!
//! So the real check happens here, on the **resolved address**, immediately
//! before the dial, and the caller connects to the `SocketAddr` this vetted --
//! never to the hostname a second time, or a DNS rebind between the check and
//! the connect puts the private address back.

use std::net::{IpAddr, SocketAddr};

/// Ports the tunnel will relay to when nothing else is configured.
const DEFAULT_PORTS: &[u16] = &[80, 443];

/// Resolved-address and port policy for outbound relays.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DestinationPolicy {
    /// Set by `BOX_EGRESS_ALLOW_PRIVATE=1`. Off by default, and it should stay
    /// off unless someone has genuinely decided the guest may reach their LAN.
    allow_private: bool,
    /// `BOX_EGRESS_RELAY_PORTS`, comma separated. Empty means [`DEFAULT_PORTS`].
    /// A single `*` relays any port.
    ports: Option<Vec<u16>>,
}

impl DestinationPolicy {
    pub fn from_env() -> Self {
        let allow_private = matches!(
            std::env::var("BOX_EGRESS_ALLOW_PRIVATE")
                .unwrap_or_default()
                .trim(),
            "1" | "true" | "yes"
        );
        Self {
            allow_private,
            ports: parse_ports(&std::env::var("BOX_EGRESS_RELAY_PORTS").unwrap_or_default()),
        }
    }

    #[must_use]
    pub fn with_allow_private(mut self, allow: bool) -> Self {
        self.allow_private = allow;
        self
    }

    #[must_use]
    pub fn with_ports(mut self, ports: Option<Vec<u16>>) -> Self {
        self.ports = ports;
        self
    }

    pub fn port_allowed(&self, port: u16) -> bool {
        match &self.ports {
            Some(list) if list.is_empty() => true, // `*`
            Some(list) => list.contains(&port),
            None => DEFAULT_PORTS.contains(&port),
        }
    }

    /// `None` when the address may be dialled, otherwise why it may not.
    pub fn refuse_reason(&self, addr: &SocketAddr) -> Option<&'static str> {
        if !self.port_allowed(addr.port()) {
            return Some("port not relayed");
        }
        if self.allow_private {
            return None;
        }
        classify(&addr.ip())
    }

    /// Keep only the addresses this policy will dial.
    pub fn vet<I: IntoIterator<Item = SocketAddr>>(&self, addrs: I) -> Vec<SocketAddr> {
        addrs
            .into_iter()
            .filter(|addr| self.refuse_reason(addr).is_none())
            .collect()
    }
}

fn parse_ports(raw: &str) -> Option<Vec<u16>> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if raw == "*" {
        return Some(Vec::new());
    }
    let list: Vec<u16> = raw
        .split(',')
        .filter_map(|p| p.trim().parse::<u16>().ok())
        .collect();
    if list.is_empty() {
        None
    } else {
        Some(list)
    }
}

/// Why this address is not public unicast, if it isn't.
fn classify(ip: &IpAddr) -> Option<&'static str> {
    match ip {
        IpAddr::V4(v4) => {
            if v4.is_loopback() {
                return Some("loopback");
            }
            if v4.is_private() {
                return Some("private");
            }
            if v4.is_link_local() {
                // Includes 169.254.169.254, the cloud metadata address.
                return Some("link-local");
            }
            if v4.is_unspecified() {
                return Some("unspecified");
            }
            if v4.is_broadcast() {
                return Some("broadcast");
            }
            if v4.is_multicast() {
                return Some("multicast");
            }
            if v4.is_documentation() {
                return Some("documentation");
            }
            let [a, b, ..] = v4.octets();
            if a == 100 && (64..128).contains(&b) {
                return Some("carrier-grade NAT");
            }
            if a == 0 {
                return Some("this-network");
            }
            if a >= 240 {
                return Some("reserved");
            }
            None
        }
        IpAddr::V6(v6) => {
            if v6.is_loopback() {
                return Some("loopback");
            }
            if v6.is_unspecified() {
                return Some("unspecified");
            }
            if v6.is_multicast() {
                return Some("multicast");
            }
            let seg = v6.segments();
            if (seg[0] & 0xfe00) == 0xfc00 {
                return Some("unique local");
            }
            if (seg[0] & 0xffc0) == 0xfe80 {
                return Some("link-local");
            }
            // An IPv4 address wearing an IPv6 hat is still that address.
            if let Some(v4) = v6.to_ipv4_mapped() {
                return classify(&IpAddr::V4(v4));
            }
            if seg[0] == 0x2001 && seg[1] == 0x0db8 {
                return Some("documentation");
            }
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sock(s: &str, port: u16) -> SocketAddr {
        SocketAddr::new(s.parse::<IpAddr>().expect("ip"), port)
    }

    #[test]
    fn the_default_policy_refuses_the_operators_own_network() {
        let p = DestinationPolicy::default();
        for (addr, why) in [
            ("127.0.0.1", "loopback"),
            ("192.168.1.1", "private"),
            ("10.0.0.5", "private"),
            ("172.16.4.2", "private"),
            ("169.254.169.254", "link-local"),
            ("100.64.0.1", "carrier-grade NAT"),
            ("0.0.0.0", "unspecified"),
            ("::1", "loopback"),
            ("fd00::1", "unique local"),
            ("fe80::1", "link-local"),
            ("::ffff:127.0.0.1", "loopback"),
        ] {
            assert_eq!(
                p.refuse_reason(&sock(addr, 443)),
                Some(why),
                "{addr} must be refused"
            );
        }
    }

    #[test]
    fn public_unicast_on_a_web_port_is_allowed() {
        let p = DestinationPolicy::default();
        assert_eq!(p.refuse_reason(&sock("93.184.216.34", 443)), None);
        assert_eq!(p.refuse_reason(&sock("93.184.216.34", 80)), None);
        assert_eq!(p.refuse_reason(&sock("2606:2800:220:1::1", 443)), None);
    }

    #[test]
    fn ports_outside_the_web_set_need_opting_in() {
        let p = DestinationPolicy::default();
        assert_eq!(
            p.refuse_reason(&sock("93.184.216.34", 22)),
            Some("port not relayed")
        );
        assert_eq!(
            p.refuse_reason(&sock("93.184.216.34", 5432)),
            Some("port not relayed")
        );

        let open = DestinationPolicy::default().with_ports(Some(Vec::new()));
        assert_eq!(open.refuse_reason(&sock("93.184.216.34", 22)), None);

        let named = DestinationPolicy::default().with_ports(Some(vec![8443]));
        assert_eq!(named.refuse_reason(&sock("93.184.216.34", 8443)), None);
        assert_eq!(
            named.refuse_reason(&sock("93.184.216.34", 443)),
            Some("port not relayed")
        );
    }

    #[test]
    fn opting_in_to_private_is_possible_but_explicit() {
        let p = DestinationPolicy::default().with_allow_private(true);
        assert_eq!(p.refuse_reason(&sock("192.168.1.1", 443)), None);
        // The port policy still applies.
        assert_eq!(
            p.refuse_reason(&sock("192.168.1.1", 22)),
            Some("port not relayed")
        );
    }

    #[test]
    fn vet_drops_the_private_answers_and_keeps_the_public_ones() {
        let p = DestinationPolicy::default();
        let vetted = p.vet(vec![
            sock("127.0.0.1", 443),
            sock("93.184.216.34", 443),
            sock("192.168.1.1", 443),
        ]);
        assert_eq!(vetted, vec![sock("93.184.216.34", 443)]);
    }

    #[test]
    fn parse_ports_reads_a_list_a_star_and_junk() {
        assert_eq!(parse_ports(""), None);
        assert_eq!(parse_ports("  "), None);
        assert_eq!(parse_ports("*"), Some(Vec::new()));
        assert_eq!(parse_ports("80,443, 8443"), Some(vec![80, 443, 8443]));
        assert_eq!(parse_ports("nonsense"), None);
    }
}

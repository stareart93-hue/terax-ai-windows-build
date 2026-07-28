const ESC: u8 = 0x1b;
const BEL: u8 = 0x07;
const OSC_INTRO: u8 = b']';
const ST_FINAL: u8 = b'\\';

const OSC_MAX: usize = 2048;

const DEFAULT_AGENTS: &[&str] = &["claude", "codex", "gemini", "pi"];
const DEFAULT_AGENT_COMMANDS: &[(&str, &str)] = &[
    ("claude", "claude"),
    ("cc", "claude"),
    ("claude-code", "claude"),
    ("claudecode", "claude"),
    ("codex", "codex"),
    ("gemini", "gemini"),
    ("pi", "pi"),
];

// OSC 777 marker our agent hooks emit. Legacy 3-field `notify;Terax;<event>`
// (Claude) or 4-field `notify;Terax;<agent>;<event>` (Codex/Gemini/Pi).
const TERAX_MARKER: &[u8] = b"notify;Terax;";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum State {
    Ground,
    Esc,
    Osc,
    OscEsc,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Status {
    Working,
    Waiting,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Transition {
    Started { agent: String },
    Working,
    Attention,
    Finished,
    /// Session reset / cleared — the agent is back to awaiting input, viewed.
    Idle,
    Exited,
}

#[derive(Clone, serde::Serialize)]
pub struct AgentSignal {
    pub id: u32,
    pub kind: &'static str,
    pub agent: Option<String>,
}

impl Transition {
    pub fn into_signal(self, id: u32) -> AgentSignal {
        match self {
            Transition::Started { agent } => AgentSignal {
                id,
                kind: "started",
                agent: Some(agent),
            },
            Transition::Working => AgentSignal {
                id,
                kind: "working",
                agent: None,
            },
            Transition::Attention => AgentSignal {
                id,
                kind: "attention",
                agent: None,
            },
            Transition::Finished => AgentSignal {
                id,
                kind: "finished",
                agent: None,
            },
            Transition::Idle => AgentSignal {
                id,
                kind: "idle",
                agent: None,
            },
            Transition::Exited => AgentSignal {
                id,
                kind: "exited",
                agent: None,
            },
        }
    }
}

pub struct AgentDetector {
    agents: Vec<String>,
    commands: Vec<(String, String)>,
    state: State,
    osc: Vec<u8>,
    armed: bool,
    status: Status,
}

impl AgentDetector {
    pub fn new() -> Self {
        let mut commands: Vec<(String, String)> = DEFAULT_AGENT_COMMANDS
            .iter()
            .map(|(cmd, agent)| ((*cmd).to_string(), (*agent).to_string()))
            .collect();
        commands.extend(custom_claude_aliases().map(|cmd| (cmd, "claude".to_string())));
        Self::with_agents_and_commands(
            DEFAULT_AGENTS.iter().map(|s| s.to_string()).collect(),
            commands,
        )
    }

    fn with_agents_and_commands(agents: Vec<String>, commands: Vec<(String, String)>) -> Self {
        Self {
            agents,
            commands,
            state: State::Ground,
            osc: Vec::new(),
            armed: false,
            status: Status::Working,
        }
    }

    /// Feed a chunk of raw PTY output. Transitions come only from OSC sequences
    /// (`133` prompt boundaries, our `777` hook marker), never from raw output,
    /// so a TUI agent that repaints continuously never flaps working/waiting.
    pub fn process<F: FnMut(Transition)>(&mut self, input: &[u8], mut emit: F) {
        if self.state == State::Ground && !input.contains(&ESC) {
            return;
        }

        for &b in input {
            match self.state {
                State::Ground => {
                    if b == ESC {
                        self.state = State::Esc;
                    }
                }
                State::Esc => match b {
                    OSC_INTRO => {
                        self.state = State::Osc;
                        self.osc.clear();
                    }
                    ESC => {}
                    _ => self.state = State::Ground,
                },
                State::Osc => match b {
                    BEL => {
                        self.finish_osc(&mut emit);
                        self.state = State::Ground;
                    }
                    ESC => self.state = State::OscEsc,
                    _ => {
                        if self.osc.len() < OSC_MAX {
                            self.osc.push(b);
                        } else {
                            self.osc.clear();
                            self.state = State::Ground;
                        }
                    }
                },
                State::OscEsc => match b {
                    ST_FINAL => {
                        self.finish_osc(&mut emit);
                        self.state = State::Ground;
                    }
                    ESC => {}
                    _ => {
                        self.osc.clear();
                        self.state = State::Ground;
                    }
                },
            }
        }
    }

    /// Called when the underlying PTY closes. Reports the agent as exited so the
    /// UI doesn't leave a stale entry if the shell died mid-command.
    pub fn finish<F: FnMut(Transition)>(&mut self, mut emit: F) {
        if self.armed {
            self.disarm();
            emit(Transition::Exited);
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
        self.status = Status::Working;
    }

    fn finish_osc<F: FnMut(Transition)>(&mut self, emit: &mut F) {
        let body = std::mem::take(&mut self.osc);
        let (ps, pt) = match body.iter().position(|&c| c == b';') {
            Some(i) => (&body[..i], &body[i + 1..]),
            None => (&body[..], &body[0..0]),
        };
        match ps {
            b"133" => self.handle_osc133(pt, emit),
            // OSC 9;4 is taskbar progress; other OSC 9 variants and foreign
            // sequences are ignored. We previously treated them as generic
            // "attention", but agents and shells emit a lot of unrelated OSC
            // (titles, progress, iTerm integrations) which caused false
            // "needs input" states. Only our own OSC 777 markers drive state.
            b"777" => self.handle_osc777(pt, emit),
            _ => {}
        }
    }

    fn handle_osc777<F: FnMut(Transition)>(&mut self, pt: &[u8], emit: &mut F) {
        if let Some(tail) = pt.strip_prefix(TERAX_MARKER) {
            // PTY output is untrusted: only self-arm for known agents.
            let (agent, event) = match tail.iter().position(|&c| c == b';') {
                Some(i) => {
                    let Ok(name) = std::str::from_utf8(&tail[..i]) else {
                        return;
                    };
                    if !self.agents.iter().any(|a| a == name) {
                        return;
                    }
                    (name, &tail[i + 1..])
                }
                None => ("claude", tail),
            };
            // Self-arms when no shell preexec fired (bash, Windows, tmux).
            match event {
                b"working" => {
                    self.ensure_armed(agent, emit);
                    self.set_working(emit);
                }
                b"attention" => {
                    self.ensure_armed(agent, emit);
                    self.status = Status::Waiting;
                    emit(Transition::Attention);
                }
                b"finished" => {
                    self.ensure_armed(agent, emit);
                    self.status = Status::Waiting;
                    emit(Transition::Finished);
                }
                b"idle" => {
                    // SessionStart (e.g. /clear, resume): reset to awaiting
                    // input, viewed — not "finished/unread".
                    self.ensure_armed(agent, emit);
                    self.status = Status::Waiting;
                    emit(Transition::Idle);
                }
                _ => {}
            }
        }
        // Foreign OSC 777 (e.g. desktop notifications from other tools): do
        // nothing. Previously this surfaced as a false "attention" state.
    }

    fn handle_osc133<F: FnMut(Transition)>(&mut self, pt: &[u8], emit: &mut F) {
        match pt.first() {
            Some(b'C') => {
                if self.armed {
                    return;
                }
                let cmd = pt.strip_prefix(b"C;").unwrap_or(b"");
                if let Some(agent) = self.match_agent(cmd) {
                    self.armed = true;
                    self.status = Status::Working;
                    emit(Transition::Started { agent });
                }
            }
            Some(b'D') if self.armed => {
                self.disarm();
                emit(Transition::Exited);
            }
            _ => {}
        }
    }

    fn ensure_armed<F: FnMut(Transition)>(&mut self, agent: &str, emit: &mut F) {
        if !self.armed {
            self.armed = true;
            self.status = Status::Working;
            emit(Transition::Started {
                agent: agent.to_string(),
            });
        }
    }

    fn set_working<F: FnMut(Transition)>(&mut self, emit: &mut F) {
        if self.status != Status::Working {
            self.status = Status::Working;
            emit(Transition::Working);
        }
    }

    fn match_agent(&self, cmd: &[u8]) -> Option<String> {
        let cmd = std::str::from_utf8(cmd).ok()?;
        for token in cmd.split_whitespace() {
            if token.starts_with('-') {
                continue;
            }
            let base = command_base(token);
            if let Some((_, agent)) = self.commands.iter().find(|(command, _)| {
                base.strip_prefix(command.as_str())
                    .is_some_and(|rest| rest.is_empty() || rest.starts_with('-'))
            }) {
                return Some(agent.clone());
            }
        }
        None
    }
}

fn command_base(token: &str) -> String {
    let token = token.trim_matches(|c| c == '"' || c == '\'');
    let base = token
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(token)
        .to_lowercase();
    for ext in [".exe", ".cmd", ".bat", ".ps1"] {
        if let Some(stripped) = base.strip_suffix(ext) {
            return stripped.to_string();
        }
    }
    base
}

fn custom_claude_aliases() -> impl Iterator<Item = String> {
    std::env::var("TERAX_CLAUDE_ALIASES")
        .unwrap_or_default()
        .split([',', ';', ' ', '\t', '\n'])
        .filter_map(|raw| {
            let alias = command_base(raw.trim());
            if alias.is_empty() || alias.starts_with('-') {
                None
            } else {
                Some(alias)
            }
        })
        .collect::<Vec<_>>()
        .into_iter()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(d: &mut AgentDetector, input: &[u8]) -> Vec<Transition> {
        let mut out = Vec::new();
        d.process(input, |t| out.push(t));
        out
    }

    fn osc(body: &str) -> Vec<u8> {
        let mut v = vec![ESC, OSC_INTRO];
        v.extend_from_slice(body.as_bytes());
        v.extend_from_slice(&[ESC, ST_FINAL]);
        v
    }

    fn started(agent: &str) -> Transition {
        Transition::Started {
            agent: agent.into(),
        }
    }

    #[test]
    fn arms_on_agent_command() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("133;C;claude -p hello")),
            vec![started("claude")]
        );
    }

    #[test]
    fn arms_on_pi_command() {
        let mut d = AgentDetector::new();
        assert_eq!(run(&mut d, &osc("133;C;pi")), vec![started("pi")]);
    }

    #[test]
    fn arms_on_pathed_and_wrapped_command() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("133;C;/usr/local/bin/codex exec")),
            vec![started("codex")]
        );
        let mut d2 = AgentDetector::new();
        assert_eq!(
            run(&mut d2, &osc("133;C;npx claude")),
            vec![started("claude")]
        );
    }

    #[test]
    fn arms_on_dash_suffixed_alias() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("133;C;claude-enigma")),
            vec![started("claude")]
        );
    }

    #[test]
    fn arms_on_claude_command_aliases() {
        let mut cc = AgentDetector::new();
        assert_eq!(run(&mut cc, &osc("133;C;cc")), vec![started("claude")]);

        let mut dashed = AgentDetector::new();
        assert_eq!(
            run(
                &mut dashed,
                &osc("133;C;claude-code --dangerously-skip-permissions")
            ),
            vec![started("claude")]
        );

        let mut windows = AgentDetector::new();
        assert_eq!(
            run(&mut windows, &osc(r"133;C;C:\Users\me\bin\cc.cmd")),
            vec![started("claude")]
        );

        let mut package = AgentDetector::new();
        assert_eq!(
            run(
                &mut package,
                &osc("133;C;pnpm dlx @anthropic-ai/claude-code")
            ),
            vec![started("claude")]
        );
    }

    #[test]
    fn normalizes_command_base() {
        assert_eq!(command_base(r#""C:\Tools\cc.cmd""#), "cc");
        assert_eq!(command_base("@anthropic-ai/claude-code"), "claude-code");
        assert_eq!(command_base("'claude.exe'"), "claude");
    }

    #[test]
    fn does_not_arm_on_other_commands() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &osc("133;C;vim src/main.rs")).is_empty());
        assert!(run(&mut d, &osc("133;C;cat claude.txt")).is_empty());
        assert!(run(&mut d, &osc("133;C;claudexyz")).is_empty());
    }

    #[test]
    fn ignores_bell_and_plain_output() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        assert!(run(&mut d, &[BEL]).is_empty());
        assert!(run(&mut d, b"thinking...\x07more").is_empty());
    }

    #[test]
    fn terax_marker_drives_status() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;attention")),
            vec![Transition::Attention]
        );
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;working")),
            vec![Transition::Working]
        );
        assert!(run(&mut d, &osc("777;notify;Terax;working")).is_empty());
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;finished")),
            vec![Transition::Finished]
        );
    }

    #[test]
    fn terax_marker_auto_arms_without_preexec() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;attention")),
            vec![started("claude"), Transition::Attention]
        );
    }

    #[test]
    fn four_field_marker_self_arms_named_agent() {
        // Fresh arm already implies Working, so `working` emits only Started.
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;codex;working")),
            vec![started("codex")]
        );
        let mut g = AgentDetector::new();
        assert_eq!(
            run(&mut g, &osc("777;notify;Terax;gemini;finished")),
            vec![started("gemini"), Transition::Finished]
        );
    }

    #[test]
    fn pi_marker_self_arms_and_drives_status() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;pi;working")),
            vec![started("pi")]
        );
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;pi;finished")),
            vec![Transition::Finished]
        );
    }

    #[test]
    fn four_field_marker_ignores_unknown_agent() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &osc("777;notify;Terax;evil;attention")).is_empty());
        // A known agent in the same chunk still works.
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;codex;attention")),
            vec![started("codex"), Transition::Attention]
        );
    }

    #[test]
    fn four_field_marker_drives_status_after_preexec() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;gemini"));
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;gemini;attention")),
            vec![Transition::Attention]
        );
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;gemini;working")),
            vec![Transition::Working]
        );
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;gemini;finished")),
            vec![Transition::Finished]
        );
    }

    #[test]
    fn foreign_osc_is_ignored_even_when_armed() {
        // Only our own OSC 777 Terax markers drive state. Foreign OSC 777
        // (unknown agents/notify formats) and OSC 9 (progress/notifications
        // from other tools) must NOT produce false "attention" states.
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &osc("777;notify;Other;ready")).is_empty());
        run(&mut d, &osc("133;C;codex"));
        // Armed now, but foreign markers are still ignored.
        assert!(run(&mut d, &osc("777;notify;Codex;ready")).is_empty());
        assert!(run(&mut d, &osc("9;needs you")).is_empty());
        assert!(run(&mut d, &osc("9;4;1;50")).is_empty());
    }

    #[test]
    fn exits_on_133d() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        assert_eq!(run(&mut d, &osc("133;D;0")), vec![Transition::Exited]);
        assert!(run(&mut d, &osc("133;D;0")).is_empty());
    }

    #[test]
    fn bel_terminator_inside_osc_is_not_attention() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        let mut seq = vec![ESC, OSC_INTRO];
        seq.extend_from_slice(b"0;set title");
        seq.push(BEL);
        assert!(run(&mut d, &seq).is_empty());
    }

    #[test]
    fn started_split_across_chunks() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &[ESC, OSC_INTRO]).is_empty());
        assert!(run(&mut d, b"133;C;cla").is_empty());
        let mut out = run(&mut d, b"ude");
        out.extend(run(&mut d, &[ESC, ST_FINAL]));
        assert_eq!(out, vec![started("claude")]);
    }

    #[test]
    fn finish_reports_exited_when_armed() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        let mut out = Vec::new();
        d.finish(|t| out.push(t));
        assert_eq!(out, vec![Transition::Exited]);
        let mut out2 = Vec::new();
        d.finish(|t| out2.push(t));
        assert!(out2.is_empty());
    }

    #[test]
    fn oversized_osc_does_not_panic() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        let mut seq = vec![ESC, OSC_INTRO];
        seq.extend(std::iter::repeat_n(b'x', OSC_MAX + 100));
        seq.extend_from_slice(&[ESC, ST_FINAL]);
        assert!(run(&mut d, &seq).is_empty());
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;attention")),
            vec![Transition::Attention]
        );
    }

    #[test]
    fn working_signal_recovers_from_attention() {
        // After a Notification (attention), the user answers and Claude resumes
        // working — modeled by a PreToolUse/UserPromptSubmit "working" marker.
        // The detector must flip back to Working and emit the transition; this
        // is what unsticks the UI from "attention" while the agent keeps going.
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;attention")),
            vec![Transition::Attention]
        );
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;working")),
            vec![Transition::Working]
        );
        // A second working while already working is deduped (no flap).
        assert!(run(&mut d, &osc("777;notify;Terax;working")).is_empty());
    }

    #[test]
    fn idle_signal_resets_from_finished_and_attention() {
        // SessionStart (e.g. /clear) emits "idle", which resets a finished or
        // attention state back to idle (awaiting input, viewed).
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        // finished -> idle
        run(&mut d, &osc("777;notify;Terax;finished"));
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;idle")),
            vec![Transition::Idle]
        );
        // attention -> idle
        run(&mut d, &osc("777;notify;Terax;attention"));
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;idle")),
            vec![Transition::Idle]
        );
    }
}

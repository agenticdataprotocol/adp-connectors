# adp-skills

Agent skills for ADP (Agentic Data Protocol) integration.

## Available Skills

| Skill | Description |
|-------|-------------|
| [adp-mcp-skill](adp-mcp-skill/) | Guide for querying and operating on data through ADP MCP tools |
| [adp-openclaw-skill](adp-openclaw-skill/) | Guide for using ADP tools in OpenClaw agents (discover, query, ingest, revise data resources) |

## Installation

### OpenClaw Skills

To use an ADP skill with your OpenClaw agent, symlink or copy the skill
directory into your OpenClaw workspace:

```bash
# Symlink (recommended for development)
ln -s /path/to/adp-connectors/adp-skills/adp-openclaw-skill ~/.openclaw/skills/adp-openclaw-skill

# Or copy
cp -r /path/to/adp-connectors/adp-skills/adp-openclaw-skill ~/.openclaw/skills/
```

The skill will be automatically discovered on the next gateway restart.

### MCP Skills

For MCP-based setups, follow the installation instructions in
[adp-mcp-skill/SKILL.md](adp-mcp-skill/SKILL.md).

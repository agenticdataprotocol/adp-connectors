# adp-skills

Agent skills for ADP (Agentic Data Protocol) integration.

## Available Skills

| Skill | Description |
|-------|-------------|
| [adp-mcp-skill](adp-mcp-skill/) | Guide for querying and operating on data through ADP MCP tools |

## Prerequisites

The `adp-mcp-skill` requires the **adp-mcp** connector. Follow the instructions in the [adp-mcp README](../adp-mcp/README.md) to configure the MCP server for your client before installing this skill.

## Installation

Each skill directory contains a `SKILL.md` file with the skill content. The installation method depends on your MCP client.

#### Claude Desktop

Upload the `SKILL.md` file via [Customize > Skills](https://claude.ai/customize/skills).

See [Use Skills in Claude](https://support.claude.com/en/articles/12512180-use-skills-in-claude#h_a4222fa77b) for details.

#### VS Code

Copy the skill directory into your workspace's `.github/skills/` directory:

```bash
mkdir -p .github/skills
cp -r adp-mcp-skill .github/skills/
```

See [Agent Skills in VS Code](https://code.visualstudio.com/docs/copilot/customization/agent-skills) for details.

#### Codex CLI

Copy the skill directory into your repository's `.agents/skills/` directory:

```bash
mkdir -p .agents/skills
cp -r adp-mcp-skill .agents/skills/
```

See [Codex Skills](https://developers.openai.com/codex/skills) for details.

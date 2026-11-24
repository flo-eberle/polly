# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| latest release | Yes |
| older releases | No  |

## Reporting a Vulnerability

If you discover a security vulnerability in Polly, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email the maintainer directly or use [GitHub's private vulnerability reporting](https://github.com/flo-eberle/polly/security/advisories/new)
3. Include a description of the vulnerability, steps to reproduce, and potential impact

We will respond within 48 hours and work on a fix promptly.

## Security Considerations

Polly is a client-side application that stores all data in the browser's localStorage. No data is sent to external servers unless the user explicitly configures a backend URL.

- **No authentication required** for the static site (data is local to the browser)
- **Weather API keys** are stored in localStorage and only sent to the configured weather API
- **Backend (Docker)** is optional. Without `GARDENER_TOKEN` its API is open, which is only acceptable on a trusted network; set the token before exposing it anywhere else (see README, "Running the backend safely").
- **SVG rendering** uses hardcoded static assets only, no user-supplied SVG content

## Dependencies

We use Dependabot to monitor and update dependencies automatically. Critical security updates are applied as soon as possible.

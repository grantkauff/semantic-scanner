# Security policy

Semantic Scanner is a community application, not an official Microsoft product.
Security fixes target the main branch and the latest tagged release, when one
exists. Fabric and Entra platform support remain the responsibility of their
respective providers.

## Report privately

Do not post vulnerabilities, access tokens, model metadata, tenant logs, or
customer data in public issues or pull requests.

Use [GitHub private vulnerability reporting](https://github.com/grantkauff/semantic-scanner/security/advisories/new)
for this repository. If that feature is not available, open an issue saying
only that you need a private security contact, without exploit details or
sensitive attachments. A maintainer can arrange a private channel.

Include affected versions, impact, minimal reproduction steps, and a sanitized
example. Do not include production credentials or business data.

Issues in Microsoft Fabric, Entra, or an upstream dependency should also be
reported through that provider's security process. Microsoft scaffold notices
do not make Microsoft the maintainer of this application's security reports.

## Deployment responsibilities

- Keep hosted assets protected, Fabric authentication enabled, password
  authentication disabled, and the application authentication gate intact.
- Use a tenant-owned secretless SPA registration with the documented delegated
  read scopes. `Dataset.Read.All` is broader than metadata-only access even
  though this app only issues fixed metadata queries.
- Protect local configuration, CLI token caches, and generated deployment files.
  Never publish secrets or use another person's feed or source credentials.
- Review sharing, source permissions, capacity, consent, MFA, and Conditional
  Access with the tenant/workspace administrator.
- Validate signed-out, signed-in, restored-session, source-access, and actual
  Fabric-embedded behavior before sharing an installation.

An audit with no confirmed findings is not a security guarantee. HTTP-only
hosting controls, tenant policies, model permissions, and preview-service
availability require independent verification in each environment.

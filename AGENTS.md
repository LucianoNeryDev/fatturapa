# Agent instructions

- Dependency-free TypeScript library: never add runtime dependencies.
- Amounts are integer cents and quantities 8-decimal fixed point (`bigint`); never compute money with floating point.
- Keep validation exhaustive: report every issue with its input path instead of throwing on the first.
- Elements must follow the order of the official schema. Run `npm run test:schema` after any change to the XML.
- Before committing: `npm run typecheck`, `npm test`, `npm run format:check`.
- Document user-visible changes in `docs/guide.md`, `README.md` when it changes the front door, and `CHANGELOG.md`.

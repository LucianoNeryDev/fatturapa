# Contributing

Thanks for helping with fatturapa. This page covers the rules the library keeps and the checks to run before you open a pull request.

## Principles

- **No runtime dependencies.** fatturapa is a dependency-free TypeScript library. Do not add runtime dependencies; development tooling goes in `devDependencies`.
- **Exact money.** Amounts are integer cents and quantities are 8-decimal fixed point (`bigint`). Never compute money with floating point.
- **Exhaustive validation.** Report every issue with its input path instead of throwing on the first one.
- **Schema order.** Elements must follow the order of the official FatturaPA schema. Run `npm run test:schema` after any change to the generated XML.

## Setup

You need Node.js 20 or later.

```sh
npm ci
```

## Checks

Run these before you commit. CI runs them on Node 20, 22 and 24.

```sh
npm run typecheck
npm test
npm run format:check   # npm run format fixes the formatting
npm run test:schema    # validates generated files against the official XSD (needs curl and xmllint)
```

## Documentation

Document user-visible changes in the same pull request:

- `docs/guide.md` for anything that changes how the library is used.
- `README.md` when the change affects the front door (features, install, supported documents).
- `CHANGELOG.md` for every user-visible change.

## Pull requests

Branch from `dev`, keep each pull request focused on one change, and open it against `dev`. Short, descriptive commit messages are enough.

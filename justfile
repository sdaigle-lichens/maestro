# Run `just` with no arguments to list recipes.
default:
    @just --list

# Install workspace dependencies
install:
    pnpm install

# Run the Maestro desktop app in dev mode
dev:
    pnpm --filter maestro dev

# Build and preview the Maestro desktop app
start: build
    pnpm --filter maestro start

# Build every package and app
build:
    pnpm build

# Regenerate plugins/maestro/scripts/lib/*.cjs from plugin-entries/*.ts
plugin-libs:
    pnpm --filter maestro build:plugin-libs

lint:
    pnpm lint

# Prettier check across the repo
check:
    pnpm check

typecheck:
    pnpm typecheck

test:
    pnpm test

# check + typecheck + test
verify:
    pnpm verify

# Write prettier formatting
format:
    pnpm format

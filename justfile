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

# Local design studio (Docker). The compose file lives in the ai-dev-tools checkout; override with DESIGN_STUDIO_DIR.
design_studio_dir := env('DESIGN_STUDIO_DIR', home_directory() / 'gits/ai-dev-tools/apps/design-studio')
design_studio_port := env('STUDIO_PORT', '3009')

# Build and start the design studio for this repo
design-studio:
    PROJECT_DIR="{{ justfile_directory() }}" STUDIO_PORT={{ design_studio_port }} HOST_UID=$(id -u) HOST_GID=$(id -g) docker compose -f "{{ design_studio_dir }}/docker-compose.yml" -p design-maestro up -d --build
    @echo "Design studio: http://localhost:{{ design_studio_port }}"

# Stop the design studio
design-studio-down:
    PROJECT_DIR="{{ justfile_directory() }}" docker compose -f "{{ design_studio_dir }}/docker-compose.yml" -p design-maestro down

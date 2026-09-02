# Gotchas (environment facts learned the hard way)

## Host port 5432 is already owned by an unrelated project
This machine has other docker-compose projects (`restaurantapp-db-1`) that bind
host port 5432. `docker compose up -d postgres` with a `5432:5432` mapping
starts without error but silently fails to publish the port if it's taken —
`docker ps` shows the container with no host port at all, and a client
connecting to `localhost:5432` instead reaches the *other* project's Postgres,
producing a misleading `password authentication failed` error rather than
`connection refused`.
Evidence: `docker-compose.yml` (P0 commit) maps Postgres to host port
**55432**, not 5432; `.env` / `.env.example` `DATABASE_URL*` use `:55432`.
If `docker ps` ever shows this project's postgres container with an empty
PORTS column, check for a port collision with another project first.

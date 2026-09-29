.PHONY: help compose up down logs init plugins run check sources status test provision affiliate-up affiliate-down affiliate-logs affiliate-migrate affiliate-seed affiliate-test

PY ?= python3

help:            ## show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

compose:         ## regenerate docker-compose.yml from autopub/config/sites.yaml
	$(PY) infra/gen_compose.py

up: compose      ## start / update the whole stack on the server
	docker compose up -d --build --remove-orphans

down:            ## stop the stack (data volumes are kept)
	docker compose down

logs:            ## follow the publisher logs
	docker compose logs -f --tail=200 autopub

init:            ## install WordPress on every site + create autopub app passwords
	./infra/wp/init-sites.sh

plugins:         ## copy repo-local plugins into their containers ("make up" does not)
	./infra/wp/deploy-plugins.sh

run:             ## publish one cycle right now (all sites)
	docker compose run --rm autopub python -m autopub run

check:           ## verify WordPress + social credentials
	docker compose run --rm autopub python -m autopub check

sources:         ## show what the feeds currently offer
	docker compose run --rm autopub python -m autopub sources

status:          ## what has been published so far
	docker compose run --rm autopub python -m autopub status

test:            ## run the unit tests locally
	cd autopub && $(PY) -m pytest -q
	$(PY) infra/gen_compose.py --check

provision:       ## create the Linode, set DNS, deploy (run from your laptop)
	./infra/linode/provision.sh

# ---- affiliate platform (affiliate/): profile "affiliate", off until COMPOSE_PROFILES=affiliate in .env ----
AFFILIATE_SERVICES = affiliate_db affiliate_redis affiliate_migrate affiliate_api affiliate_redirect affiliate_workers affiliate_web

affiliate-up:      ## build + start the affiliate platform (migrations run first)
	docker compose --profile affiliate up -d --build $(AFFILIATE_SERVICES)

affiliate-down:    ## stop + remove only the affiliate containers (data volumes are kept)
	docker compose --profile affiliate rm --stop --force $(AFFILIATE_SERVICES)

affiliate-logs:    ## follow the affiliate API / redirect / workers / web logs
	docker compose --profile affiliate logs -f --tail=200 affiliate_api affiliate_redirect affiliate_workers affiliate_web

affiliate-migrate: ## apply pending affiliate migrations (idempotent)
	docker compose --profile affiliate run --rm affiliate_migrate node db/migrate.mjs

affiliate-seed:    ## seed the fleet as the first publisher + TEST demo programme (prints web_placement_id)
	docker compose --profile affiliate run --rm affiliate_migrate ./node_modules/.bin/tsx db/seed-fleet.ts --with-demo-programme

affiliate-test:    ## run the affiliate unit tests locally
	cd affiliate && ./node_modules/.bin/vitest run

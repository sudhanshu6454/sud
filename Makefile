.PHONY: help compose up down logs init run check sources status test provision

PY ?= python3

help:            ## show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

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

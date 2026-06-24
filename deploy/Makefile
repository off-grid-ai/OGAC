# Off Grid Console — canonical OSS stack lifecycle. Profiles map to capabilities.
COMPOSE = docker compose -f docker-compose.yml

.PHONY: up full config ps logs down smoke verify test-integrations identity-setup \
        data secrets observability guardrails policy identity lineage llmops agents ai qa

full up:       ## Bring up the FULL 5-layer stack (everything)
	$(COMPOSE) --profile all up -d
data:          ## Postgres + pgvector + SeaweedFS
	$(COMPOSE) --profile data up -d
ai:            ## Qdrant (vector store alternative)
	$(COMPOSE) --profile ai up -d
secrets:       ## OpenBao
	$(COMPOSE) --profile secrets up -d
observability: ## OTel Collector + VictoriaMetrics + VictoriaLogs
	$(COMPOSE) --profile observability up -d
guardrails:    ## Presidio analyzer + anonymizer
	$(COMPOSE) --profile guardrails up -d
policy:        ## Open Policy Agent
	$(COMPOSE) --profile policy up -d
identity:      ## Keycloak
	$(COMPOSE) --profile identity up -d
lineage:       ## Marquez (OpenLineage) + web
	$(COMPOSE) --profile lineage up -d
llmops:        ## Langfuse (LLM tracing / evals / cost)
	$(COMPOSE) --profile llmops up -d
agents:        ## Temporal + UI (durable workflows)
	$(COMPOSE) --profile agents up -d
qa:            ## Agent-QA sidecars (Evidently drift + Ragas RAG metrics)
	$(COMPOSE) --profile qa up -d --build

config:        ## Validate the compose file
	$(COMPOSE) --profile all config -q && echo "compose OK"
ps:            ## Running services
	$(COMPOSE) ps
logs:          ## Tail logs
	$(COMPOSE) --profile all logs -f
down:          ## Stop everything (keeps volumes)
	$(COMPOSE) --profile all down

smoke:         ## Health-check the running services
	@echo "postgres        $$(pg_isready -h 127.0.0.1 -U offgrid 2>/dev/null || echo down)"
	@echo "openbao         $$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8200/v1/sys/health)"
	@echo "victoriametrics $$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8428/health)"
	@echo "otel-collector  $$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4318 || echo n/a)"
	@echo "presidio        $$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5002/health)"
	@echo "opa             $$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8181/health)"
	@echo "keycloak        $$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/)"
	@echo "qdrant          $$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6333/healthz)"
	@echo "marquez         $$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9000/api/v1/namespaces)"
	@echo "langfuse        $$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3030/api/public/health)"
	@echo "temporal-ui     $$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/)"

verify:        ## Behavior-test the swappable adapters (not just reachability)
	@bash ../scripts/verify-adapters.sh

test-integrations: ## API-test the wired adapters end to end (console routes + OSS service APIs)
	@bash ../scripts/test-integrations.sh

identity-setup: ## Provision the Keycloak realm/client/user + print the AUTH_KEYCLOAK_* env
	@bash ../scripts/keycloak-setup.sh

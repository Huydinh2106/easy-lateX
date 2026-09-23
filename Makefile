.PHONY: dev migrate migration seed lint typecheck test integration frontend-test e2e logs worker-logs stop reset-data

dev:
	docker compose up --build

migrate:
	docker compose run --rm api npx prisma migrate deploy

migration:
	cd backend && npm run prisma:migrate

seed:
	docker compose run --rm api npm run prisma:seed

lint:
	cd backend && npm run lint

typecheck:
	cd backend && npm run typecheck
	cd frontend && npm run typecheck

test:
	cd backend && npm test
	cd frontend && npm test

integration: e2e

frontend-test:
	cd frontend && npm test

e2e:
	docker compose up -d --build --wait
	node scripts/e2e-smoke.mjs

logs:
	docker compose logs -f api frontend

worker-logs:
	docker compose logs -f compile-worker

stop:
	docker compose down

reset-data:
	@test "$(CONFIRM)" = "yes" || (echo "Destructive: rerun as 'make reset-data CONFIRM=yes'" && exit 1)
	docker compose down -v

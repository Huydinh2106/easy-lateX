#!/bin/sh
set -eu

attempt=1
max_attempts=30

until alembic upgrade head; do
    if [ "$attempt" -ge "$max_attempts" ]; then
        echo >&2 "Database migrations failed after $max_attempts attempts."
        exit 1
    fi

    echo >&2 "Database is not ready; retrying migration ($attempt/$max_attempts)."
    attempt=$((attempt + 1))
    sleep 2
done

exec uvicorn app.main:app --host 0.0.0.0 --port 8000

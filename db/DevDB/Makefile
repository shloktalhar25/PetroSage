.PHONY: build release test bench run serve fmt lint check docker-build docker-up clean

# Build in debug mode
build:
	cargo build

# Build optimized release binary
release:
	cargo build --release

# Run all tests (unit + integration)
test:
	cargo test

# Run criterion benchmarks (release mode for accurate numbers)
bench:
	cargo bench

# Run the oil & gas demo example
run:
	cargo run --example oil_gas_demo

# Run the HTTP server (release mode) for the Python RAG app to talk to
serve:
	cargo run --release --features server --bin devdb-server

# Check formatting
fmt:
	cargo fmt --check

# Run clippy with warnings as errors
lint:
	cargo clippy -- -D warnings

# Pre-submission gate: format check + clippy + all tests
check: fmt lint test
	@echo "All checks passed."

# Build the Docker image
docker-build:
	docker build -t devdb .

# Bring up DevDB + Qdrant for comparison benchmarks
docker-up:
	docker compose up -d

# Remove build artifacts
clean:
	cargo clean

.PHONY: help assets verify-assets font virgil clean build build-for build-all version

APP_NAME    := whiteboard
MODULE      := github.com/Tanq16/whiteboard

VERSION ?= dev-build
GOOS    ?= $(shell go env GOOS)
GOARCH  ?= $(shell go env GOARCH)

TAILWIND_VERSION         := 4.3.3
LUCIDE_VERSION           := 1.34.0
PERFECT_FREEHAND_VERSION := 1.2.3

STATIC_DIR := internal/server/static
JS_DIR     := $(STATIC_DIR)/js
CSS_DIR    := $(STATIC_DIR)/css
FONTS_DIR  := $(STATIC_DIR)/fonts
STAMP      := $(STATIC_DIR)/.assets-stamp

UA := Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36

CYAN  := \033[0;36m
GREEN := \033[0;32m
NC    := \033[0m

help: ## Show this help
	@echo "$(CYAN)Available targets:$(NC)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-20s$(NC) %s\n", $$1, $$2}'

.DEFAULT_GOAL := help

assets: $(STAMP) ## Download pinned frontend assets (never committed)
	@:

$(STAMP): $(MAKEFILE_LIST)
	@mkdir -p $(JS_DIR) $(CSS_DIR) $(FONTS_DIR)
	@curl -sfL "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@$(TAILWIND_VERSION)" -o "$(JS_DIR)/tailwind.js"
	@curl -sfL "https://cdn.jsdelivr.net/npm/lucide@$(LUCIDE_VERSION)/dist/umd/lucide.min.js" -o "$(JS_DIR)/lucide.min.js"
	@curl -sfL "https://cdn.jsdelivr.net/npm/perfect-freehand@$(PERFECT_FREEHAND_VERSION)/dist/esm/index.mjs" -o "$(JS_DIR)/perfect-freehand.esm.js"
	@cp "$(JS_DIR)/perfect-freehand.esm.js" "$(JS_DIR)/perfect-freehand.js"
	@$(MAKE) --no-print-directory font FAMILY="Inter" SLUG=inter WEIGHTS="400;500;600;700"
	@$(MAKE) --no-print-directory font FAMILY="Google+Sans" SLUG=google-sans WEIGHTS="400;500;700"
	@$(MAKE) --no-print-directory font FAMILY="JetBrains+Mono" SLUG=jetbrains-mono WEIGHTS="400;700"
	@$(MAKE) --no-print-directory virgil
	@touch $(STAMP)
	@echo "$(GREEN)Assets downloaded$(NC)"

font:
	@curl -sfL -H "User-Agent: $(UA)" \
	  "https://fonts.googleapis.com/css2?family=$(FAMILY):wght@$(WEIGHTS)&display=swap" \
	  -o "$(CSS_DIR)/$(SLUG).raw"
	@awk '/^\/\* /{keep = ($$0 ~ /^\/\* latin(-ext)? \*\/$$/)} keep' \
	  "$(CSS_DIR)/$(SLUG).raw" > "$(CSS_DIR)/$(SLUG).css"
	@rm -f "$(CSS_DIR)/$(SLUG).raw"
	@grep -o 'https://fonts.gstatic.com/[^)]*' "$(CSS_DIR)/$(SLUG).css" | sort -u \
	  | xargs -P 8 -I{} sh -c 'curl -sfL "$$1" -o "$(FONTS_DIR)/$$(basename "$$1")"' _ {}
	@sed -i.bak -E 's|https://fonts\.gstatic\.com/[^)]*/([^/)]+)|/static/fonts/\1|g' "$(CSS_DIR)/$(SLUG).css"
	@rm -f "$(CSS_DIR)/$(SLUG).css.bak"

virgil:
	@curl -sfL "https://raw.githubusercontent.com/excalidraw/excalidraw/master/public/Virgil.woff2" -o "$(FONTS_DIR)/Virgil.woff2"
	@printf '@font-face {\n  font-family: "Virgil";\n  font-style: normal;\n  font-weight: 400;\n  font-display: swap;\n  src: url("/static/fonts/Virgil.woff2") format("woff2");\n}\n' > "$(CSS_DIR)/virgil.css"

verify-assets: ## Fail early if the embedded tree is missing an asset
	@test -s $(JS_DIR)/tailwind.js || (echo "tailwind.js missing, run 'make assets'" && exit 1)
	@test -s $(JS_DIR)/lucide.min.js || (echo "lucide.min.js missing, run 'make assets'" && exit 1)
	@test -s $(JS_DIR)/perfect-freehand.js || (echo "perfect-freehand.js missing, run 'make assets'" && exit 1)
	@test -s $(CSS_DIR)/inter.css || (echo "inter.css missing, run 'make assets'" && exit 1)
	@test -s $(CSS_DIR)/google-sans.css || (echo "google-sans.css missing, run 'make assets'" && exit 1)
	@test -s $(CSS_DIR)/jetbrains-mono.css || (echo "jetbrains-mono.css missing, run 'make assets'" && exit 1)
	@test -s $(FONTS_DIR)/Virgil.woff2 || (echo "Virgil.woff2 missing, run 'make assets'" && exit 1)
	@test -s $(CSS_DIR)/virgil.css || (echo "virgil.css missing, run 'make assets'" && exit 1)

clean: ## Remove built binaries and downloaded assets
	@rm -f $(APP_NAME) $(APP_NAME)-* $(STAMP)
	@rm -rf $(JS_DIR) $(CSS_DIR) $(FONTS_DIR)
	@echo "$(GREEN)Cleaned$(NC)"

build: assets verify-assets ## Build for the current platform
	@go build -ldflags="-s -w -X '$(MODULE)/cmd.AppVersion=$(VERSION)'" -o $(APP_NAME) .
	@echo "$(GREEN)Built: ./$(APP_NAME)$(NC)"

build-for: verify-assets ## Build for a specific GOOS/GOARCH
	@CGO_ENABLED=0 GOOS=$(GOOS) GOARCH=$(GOARCH) go build \
	  -ldflags="-s -w -X '$(MODULE)/cmd.AppVersion=$(VERSION)'" \
	  -o $(APP_NAME)-$(GOOS)-$(GOARCH) .
	@echo "$(GREEN)Built: ./$(APP_NAME)-$(GOOS)-$(GOARCH)$(NC)"

build-all: assets verify-assets ## Build every platform binary
	@$(MAKE) build-for GOOS=linux  GOARCH=amd64
	@$(MAKE) build-for GOOS=linux  GOARCH=arm64
	@$(MAKE) build-for GOOS=darwin GOARCH=amd64
	@$(MAKE) build-for GOOS=darwin GOARCH=arm64

version: ## Print the next version, derived from the last commit message
	@LATEST_TAG=$$(git tag --sort=-v:refname | head -n1 || echo "0.0.0"); \
	LATEST_TAG=$${LATEST_TAG#v}; \
	MAJOR=$$(echo "$$LATEST_TAG" | cut -d. -f1); \
	MINOR=$$(echo "$$LATEST_TAG" | cut -d. -f2); \
	PATCH=$$(echo "$$LATEST_TAG" | cut -d. -f3); \
	MAJOR=$${MAJOR:-0}; MINOR=$${MINOR:-0}; PATCH=$${PATCH:-0}; \
	COMMIT_MSG="$$(git log -1 --pretty=%B 2>/dev/null || echo "")"; \
	if echo "$$COMMIT_MSG" | grep -q "\[major-release\]"; then \
		MAJOR=$$((MAJOR + 1)); MINOR=0; PATCH=0; \
	elif echo "$$COMMIT_MSG" | grep -q "\[minor-release\]"; then \
		MINOR=$$((MINOR + 1)); PATCH=0; \
	else \
		PATCH=$$((PATCH + 1)); \
	fi; \
	echo "v$${MAJOR}.$${MINOR}.$${PATCH}"

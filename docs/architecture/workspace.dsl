// The C4 model of this repository, written by the human and only read by the
// system (D-037). Every element maps itself to code with the `tomsquad.paths`
// property: comma-separated globs, matched against repository-relative paths.
// The file is a Protected Path for every Worker of every Task, so no Worker and
// no docs Task changes it — a change to the model is a change the human makes.
//
// The system's own paths carry the repository's documents, so a documentation
// unit or a runbook counts as mapped: otherwise every docs Task's pull request
// would carry one `architecture-unmapped` finding per unit it wrote.

workspace "Nudel Liefer App" {

    model {
        operator = person "Office operator" "Maintains customers, products and orders, and plans the delivery dates the tours are built for."
        driver = person "Delivery driver" "Works today's tour on a phone: stop order, quantities, shop and parking photos, navigation."

        app = softwareSystem "Nudel Liefer App" "Delivery management for a pasta factory: order capture, one optimised tour per delivery date, and the driver's mobile app." {
            properties {
                "tomsquad.paths" "docs/**, README.md, projektbeschreibung.md, backlog.md, AGENTS.md"
            }

            web = container "Next.js application" "Server-rendered pages, route handlers, server actions, and the admin and driver surfaces in one deployment." "TypeScript, React 19, Next.js 16" {
                properties {
                    "tomsquad.paths" "src/**, scripts/**, next.config.ts, prisma.config.ts, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, tsconfig.json, vitest.config.ts, eslint.config.mjs"
                }

                auth = component "Authentication and access control" "Password login, the Auth.js session, CSRF, login throttling, cron authentication and the role matrix that decides who may reach an action." "TypeScript" {
                    properties {
                        "tomsquad.paths" "src/server/auth/**, src/server/session.ts, src/server/csrf.ts, src/server/admin-password.ts, src/server/throttle.ts, src/server/cron-auth.ts, src/lib/access.ts, src/app/api/auth/**, src/app/api/session-ended/**"
                    }
                }

                tours = component "Orders, tours and stops" "Order capture, the one optimised tour per delivery date, late orders, and the driver's stop-by-stop view with its sync payload." "TypeScript" {
                    properties {
                        "tomsquad.paths" "src/server/orders.ts, src/server/order-*.ts, src/server/tour-*.ts, src/server/tours.ts, src/server/late-orders.ts, src/server/stop-*.ts, src/server/driver-*.ts, src/server/driver-locale*.ts, src/domain/day-tours.ts, src/domain/driver-*.ts, src/domain/load-sheet.ts, src/lib/driver-tour-model.ts"
                    }
                }

                customers = component "Customers and imports" "Customer master data, notes, pins and coordinates, the spreadsheet import, and the searchable customer list." "TypeScript" {
                    properties {
                        "tomsquad.paths" "src/server/customer*.ts, src/server/customers.ts, src/server/import-xlsx.ts, src/server/geocode-actions.ts, src/domain/customer*.ts, src/domain/import-file.ts, src/lib/customer-list-params.ts"
                    }
                }

                photos = component "Photos and uploads" "Uploads of shop, parking and delivery photos, their storage keys and the signed URLs the driver and office screens receive." "TypeScript" {
                    properties {
                        "tomsquad.paths" "src/server/uploads.ts, src/server/customer-photos.ts, src/server/driver-photos.ts, src/server/screenshot-retention.ts, src/lib/uploads.ts, src/lib/upload-image.ts, src/app/api/uploads/**"
                    }
                }

                audit = component "Audit log and retention" "The audit trail every administrative action appends to, and the scheduled jobs that prune audit rows, orders, tours and photos according to the retention settings." "TypeScript" {
                    properties {
                        "tomsquad.paths" "src/server/audit*.ts, src/server/data-retention*.ts, src/server/retention-cron.ts, src/server/orphan-cleanup*.ts, src/server/demo-*.ts, src/domain/audit.ts"
                    }
                }

                i18n = component "Localization" "German and Chinese (Simplified, Hong Kong and Taiwan) message catalogs, the locale resolution the request uses, and the conversion between script variants." "TypeScript, next-intl" {
                    properties {
                        "tomsquad.paths" "src/i18n/**, messages/**, src/lib/localized-text*.ts, src/lib/opencc.ts, src/lib/locale-*.ts, src/lib/navigation.ts, src/server/locale*.ts, src/server/problem-note-translation.ts, scripts/i18n-*.ts"
                    }
                }

                ui = component "Admin and driver interfaces" "The staff screens for customers, orders, tours and settings, the driver screens for today's tour, and the shared component library they are built from." "TypeScript, React, Tailwind CSS" {
                    properties {
                        "tomsquad.paths" "src/components/**, src/app/**, src/lib/format.ts, src/lib/units.ts, src/lib/coords.ts, src/lib/product-label.ts, src/lib/zoom.ts, src/lib/map-config.ts"
                    }
                }
            }

            db = container "PostgreSQL database" "Orders, tours, stops, customers, users, settings, audit rows and the retention state, with the schema and its migrations in the repository." "PostgreSQL 16, Prisma 7" {
                properties {
                    "tomsquad.paths" "prisma/**, src/server/db.ts"
                }
            }

            storage = container "Photo storage" "Shop, parking and delivery photos, served to the browser through signed URLs." "S3-compatible API (MinIO locally)" {
                properties {
                    "tomsquad.paths" "src/server/uploads.ts, src/lib/uploads.ts"
                }
            }

            sw = container "Service worker" "The offline shell: caches the app, the tour payload and map tiles, and replays the driver's queued stop updates when the device is online again." "Service worker, IndexedDB" {
                properties {
                    "tomsquad.paths" "src/sw/**, scripts/build-pwa.ts, scripts/generate-pwa-icons.ts, src/lib/pwa.ts, src/lib/install-prompt.ts, src/lib/use-online.ts, src/lib/device.ts, src/lib/client-id.ts"
                }
            }
        }

        tiles = softwareSystem "OpenStreetMap tile server" "The map tiles the driver map loads, and the service worker caches for an offline day." {
            tags "External"
        }

        sentry = softwareSystem "Sentry" "Error and performance reporting, switched off unless a deployment configures a DSN." {
            tags "External"
        }

        operator -> web "Enters customers, orders and tours" "HTTPS"
        driver -> web "Opens today's tour, updates stops, uploads photos" "HTTPS"

        web -> db "Reads and writes orders, tours, customers, users and audit rows" "SQL via Prisma"
        web -> storage "Stores and serves shop, parking and delivery photos" "S3 API"
        web -> tiles "Loads map tiles for the driver map" "HTTPS"
        web -> sentry "Reports errors and performance traces" "HTTPS"
        sw -> web "Replays queued stop updates when the device is online again" "HTTPS"
        sw -> tiles "Caches map tiles for offline use" "HTTPS"

        auth -> db "Reads users, sessions and login attempts" "SQL"
        tours -> db "Reads and writes orders, tours and stops" "SQL"
        customers -> db "Reads and writes customers, notes and pins" "SQL"
        customers -> storage "Resolves photo URLs for customer cards" "S3 API"
        photos -> storage "Writes photos and signs their URLs" "S3 API"
        audit -> db "Appends audit rows and prunes them by retention" "SQL"
    }

    views {
        systemContext app "Context" {
            include *
            autoLayout
        }

        container app "Containers" {
            include *
            autoLayout
        }

        component web "Components" {
            include *
            autoLayout
        }

        theme default
    }
}

#!/usr/bin/env python3
"""
Serveur statique de développement, sans cache.

`python3 -m http.server` laisse le navigateur garder les modules ES en cache
mémoire. Une correction dans un service peut alors rester invisible pendant
toute une session — et un module fautif continuer de tourner après avoir été
réparé. Ce serveur envoie `no-store` sur tout, ce qui supprime le problème.

Il ne sert QUE au développement. Le site publié reste un dossier de fichiers
statiques, sans étape de construction.

Usage : python3 tools/serveur-dev.py [port]
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class SansCache(SimpleHTTPRequestHandler):
    """Ajoute les en-têtes qui interdisent toute mise en cache."""

    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".mp3": "audio/mpeg",
        ".webmanifest": "application/manifest+json",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format, *args):
        # Les 404 attendus (filières non livrées) noieraient le reste.
        if args and str(args[1]).startswith("4") and "content/" in str(args[0]):
            return
        super().log_message(format, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4321
    serveur = ThreadingHTTPServer(("", port), partial(SansCache))
    print(f"WordCode — serveur de développement sans cache sur http://localhost:{port}")
    try:
        serveur.serve_forever()
    except KeyboardInterrupt:
        serveur.server_close()


if __name__ == "__main__":
    main()

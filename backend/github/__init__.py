"""Low-level GitHub REST access: an authenticated client + repo/PR operations.

Nothing here knows about OAuth, sessions, or migration campaigns — it only
ever sees a bearer token handed to it by services/github_service.py.
"""

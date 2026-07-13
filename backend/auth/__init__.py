"""GitHub authentication infrastructure: OAuth code exchange + encrypted sessions.

This package is provider-facing plumbing only — nothing here knows about
campaigns, units, or migrations. See services/github_service.py for the
facade the rest of the backend (including the migration engine) uses.
"""

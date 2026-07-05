# Superset AUTH_OAUTH via Keycloak (Flask-AppBuilder). Phase-D, READY not enabled.
# Mount at /app/pythonpath/superset_config.py, set SUPERSET_CONFIG_PATH to it in services-node-b.yml,
# run `superset init`, restart. KC client offgrid-superset is seeded. See oidc-services.md § 3.
import os

from flask_appbuilder.security.manager import AUTH_OAUTH
from superset.security import SupersetSecurityManager

AUTH_TYPE = AUTH_OAUTH

# Auto-create a Superset user on first Keycloak login; default role Gamma (limited).
AUTH_USER_REGISTRATION = True
AUTH_USER_REGISTRATION_ROLE = "Gamma"

OIDC_ISSUER = os.environ.get(
    "SUPERSET_OIDC_ISSUER", "https://auth.getoffgridai.co/realms/offgrid"
)

OAUTH_PROVIDERS = [
    {
        "name": "keycloak",
        "icon": "fa-key",
        "token_key": "access_token",
        "remote_app": {
            "client_id": "offgrid-superset",
            # Inject from OpenBao secret/superset/client-secret via env for prod:
            "client_secret": os.environ.get(
                "SUPERSET_OIDC_CLIENT_SECRET", "offgrid-dev-svc-superset-secret"
            ),
            "server_metadata_url": f"{OIDC_ISSUER}/.well-known/openid-configuration",
            "api_base_url": f"{OIDC_ISSUER}/protocol/",
            "client_kwargs": {"scope": "openid email profile"},
            "access_token_url": f"{OIDC_ISSUER}/protocol/openid-connect/token",
            "authorize_url": f"{OIDC_ISSUER}/protocol/openid-connect/auth",
            "jwks_uri": f"{OIDC_ISSUER}/protocol/openid-connect/certs",
        },
    }
]

# Map Keycloak realm roles → Superset roles.
AUTH_ROLES_MAPPING = {
    "console-admin": ["Admin"],
    "svc-superset": ["Gamma"],
}
AUTH_ROLES_SYNC_AT_LOGIN = True


class OffGridSecurityManager(SupersetSecurityManager):
    def oauth_user_info(self, provider, response=None):
        if provider == "keycloak":
            me = self.appbuilder.sm.oauth_remotes[provider].get(
                "openid-connect/userinfo"
            ).json()
            return {
                "username": me.get("preferred_username"),
                "email": me.get("email"),
                "first_name": me.get("given_name"),
                "last_name": me.get("family_name"),
                "role_keys": me.get("realm_access", {}).get("roles", []),
            }
        return {}


CUSTOM_SECURITY_MANAGER = OffGridSecurityManager

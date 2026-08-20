from jupyter_server.auth.identity import PasswordIdentityProvider, User


class StableIdentityProvider(PasswordIdentityProvider):
    """Identity provider that returns a stable username for single-user deployments."""

    def generate_anonymous_user(self, handler):
        return User(
            username="monkeycode",
            name="MonkeyCode",
            display_name="MonkeyCode",
            initials="MC",
            avatar_url=None,
            color=None,
        )


c = get_config()  # noqa: F821

c.ServerApp.password = 'argon2:$argon2id$v=19$m=10240,t=10,p=8$Y/KXz63XthDhQEn+BbgSWw$FjHjHmcpe3p+npi0IHYcqkdP1+i+mUz/n7SIS8jmMdw'
c.ServerApp.allow_root = True
c.ServerApp.ip = '0.0.0.0'
c.ServerApp.port = 8888
c.ServerApp.open_browser = False
c.ServerApp.allow_remote_access = True
c.ServerApp.allow_origin = '*'
c.ServerApp.root_dir = '/workspace'
c.ServerApp.identity_provider_class = StableIdentityProvider
c.ServerApp.jpserver_extensions = {
    "jupyter_ml_job_scheduler": True,
    "jupyter_ml_image_builder": True,
    "elyra": True,
    "jupyterlab": True,
    "jupyter_lsp": True,
    "jupyter_resource_usage": True,
    "jupyter_server_terminals": True,
    "nbdime": True,
    "notebook_shim": True,
}

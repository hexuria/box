    def ready(self) -> Any:
        return self._auth("GET", f"{self.host_url}/v1/ready")

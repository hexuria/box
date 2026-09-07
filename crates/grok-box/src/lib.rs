    pub async fn ready(&self) -> Result<Value, Error> {
        self.send_json("GET", &format!("{}/v1/ready", self.host_url), None, true)
            .await
    }

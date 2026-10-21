FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends python3 iproute2 util-linux passwd ca-certificates && rm -rf /var/lib/apt/lists/*
COPY tests/linux/systemctl.py /usr/local/bin/systemctl
RUN chmod 755 /usr/local/bin/systemctl && mkdir -p /run/systemd/system /run/lock
COPY . /src
WORKDIR /src
CMD ["bash", "tests/linux/lifecycle.sh"]

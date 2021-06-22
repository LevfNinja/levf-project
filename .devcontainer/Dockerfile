FROM node:lts-buster
ARG SOLC_VERSION=0.7.6
ARG SLITHER_ANALYZER_VERSION=0.8.0

# Install Python3 (requires by Slither)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3-pip \
        python3-dev \
        python3-setuptools \
        python3-wheel \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/home/vscode/.local/bin:${PATH}"

RUN groupadd vscode && useradd -m -g vscode vscode
USER vscode

# Set the default solc version: https://github.com/crytic/solc-select#usage
ENV SOLC_VERSION="${SOLC_VERSION}"
RUN : \
    # Install solc (requires by Slither)
    # https://docs.soliditylang.org/en/latest/installing-solidity.html#linux-packages
    # https://github.com/crytic/slither#how-to-install
    # https://github.com/crytic/solc-select
    && pip3 install solc-select \
    && solc-select install "${SOLC_VERSION}" \
    && solc --version \
    #
    # Install Slither: https://github.com/crytic/slither#how-to-install
    && pip3 install slither-analyzer=="${SLITHER_ANALYZER_VERSION}" \
    && slither --version

FROM php:8.2-cli

# Install system dependencies + librdkafka in one layer
RUN apt-get update && apt-get install -y \
    librdkafka-dev \
    librdkafka1 \
    git \
    unzip \
    curl \
    libzip-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Install zip PHP extension
RUN docker-php-ext-install zip

# Install rdkafka PHP extension
RUN pecl channel-update pecl.php.net \
    && pecl install rdkafka \
    && docker-php-ext-enable rdkafka \
    && php -m | grep rdkafka

# Install Composer via official installer (most reliable)
RUN curl -sS https://getcomposer.org/installer \
    | php -- --install-dir=/usr/local/bin --filename=composer \
    && composer --version

WORKDIR /app

# Copy and install dependencies (cached layer)
COPY composer.json ./
RUN composer install \
    --no-interaction \
    --prefer-dist \
    --optimize-autoloader \
    --ignore-platform-req=ext-rdkafka

# Copy all application files
COPY . .

# Ensure storage dir exists and is writable
RUN mkdir -p /app/storage && chmod 777 /app/storage

EXPOSE 8000

CMD ["php", "-S", "0.0.0.0:8000", "-t", "/app/api"]

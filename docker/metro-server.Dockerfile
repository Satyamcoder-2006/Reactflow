FROM node:20

WORKDIR /app

# Install Metro globally
RUN npm install -g metro metro-runtime

# Copy start script
COPY start-metro.sh /start-metro.sh
RUN chmod +x /start-metro.sh

EXPOSE 8081 8082

CMD ["/start-metro.sh"]

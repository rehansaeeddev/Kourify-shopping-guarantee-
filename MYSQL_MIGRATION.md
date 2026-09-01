# SQLite → MySQL Migration Guide

This guide walks you through migrating your Shopify app from SQLite to MySQL for production scaling.

## Why MySQL?

| Feature | SQLite | MySQL |
|---------|--------|-------|
| **Concurrent Users** | Slow (file-based locking) | ✅ Fast (network-based) |
| **Data Size** | Limited (~GB) | ✅ Unlimited (TB+) |
| **Scaling** | Can't scale horizontally | ✅ Replication, read replicas |
| **Backups** | Manual file copy | ✅ Automated snapshots |
| **Transactions** | Basic | ✅ Advanced (ACID) |
| **Production Ready** | ❌ No | ✅ Yes |

---

## Step 1: Set Up MySQL Database

### Option A: Local MySQL (Development)

**Mac (using Homebrew):**
```bash
brew install mysql
brew services start mysql
mysql -u root -p

# In MySQL prompt:
CREATE DATABASE kourify_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'kourify'@'localhost' IDENTIFIED BY 'secure_password_here';
GRANT ALL PRIVILEGES ON kourify_dev.* TO 'kourify'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

**Ubuntu/Linux:**
```bash
sudo apt-get install mysql-server
sudo mysql_secure_installation

sudo mysql -u root
CREATE DATABASE kourify_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'kourify'@'localhost' IDENTIFIED BY 'secure_password_here';
GRANT ALL PRIVILEGES ON kourify_dev.* TO 'kourify'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

**Windows (using Docker):**
```bash
docker run --name kourify-mysql \
  -e MYSQL_ROOT_PASSWORD=root_password \
  -e MYSQL_DATABASE=kourify_dev \
  -e MYSQL_USER=kourify \
  -e MYSQL_PASSWORD=secure_password \
  -p 3306:3306 \
  -d mysql:8.0
```

### Option B: Cloud MySQL (Production) — RECOMMENDED

#### **PlanetScale** (MySQL-compatible, serverless, easiest)
1. Sign up: https://planetscale.com
2. Create new database "kourify-prod"
3. Copy connection string (looks like: `mysql://user:password@aws.connect.psdb.cloud/kourify_prod?sslaccept=strict`)
4. Use this as your `DATABASE_URL`

**Pros:**
- ✅ Free tier (5GB)
- ✅ Automatic backups
- ✅ Zero maintenance
- ✅ Built-in branching for testing

**Cons:**
- ❌ Less control over configuration

#### **AWS RDS**
1. AWS Console → RDS → Create Database
2. Choose MySQL 8.0
3. Template: "Production"
4. DB Instance: `db.t3.small` (for testing) or `db.t3.medium` (for production)
5. Storage: 20GB (auto-scaling enabled)
6. Enable automated backups (7-day retention)
7. Security Group: Allow inbound on port 3306 from your app

**Connection string format:**
```
mysql://admin:your_password@kourify.xxxxx.us-east-1.rds.amazonaws.com:3306/kourify_prod
```

**Pros:**
- ✅ Full control
- ✅ Read replicas for scaling
- ✅ Automated backups
- ✅ Multi-AZ for high availability

**Cons:**
- ❌ Costs more (~$20-50/month)
- ❌ More configuration

#### **Railway** (Simple, Shopify-friendly)
1. Sign up: https://railway.app
2. New Project → Database → MySQL
3. Automatic environment variables in Railway
4. Deploy your app to Railway

---

## Step 2: Update Your `.env` File

Create a `.env` file in the root (copy from `.env.example`):

**For local development:**
```bash
DATABASE_URL="mysql://kourify:secure_password_here@localhost:3306/kourify_dev"
```

**For PlanetScale:**
```bash
DATABASE_URL="mysql://user:password@aws.connect.psdb.cloud/kourify_prod?sslaccept=strict"
```

**For AWS RDS:**
```bash
DATABASE_URL="mysql://admin:password@kourify.xxxxx.us-east-1.rds.amazonaws.com:3306/kourify_prod"
```

⚠️ **IMPORTANT:** Add `.env` to `.gitignore` (don't commit secrets!)

---

## Step 3: Generate Prisma Migration

```bash
# Install dependencies if needed
npm install

# Generate the initial migration (this creates the schema in MySQL)
npx prisma migrate dev --name init

# This will:
# 1. Create the migration file in prisma/migrations/
# 2. Apply it to your MySQL database
# 3. Generate the Prisma client
```

**Output should look like:**
```
✔ Your database is now in sync with your schema.

✔ Generated Prisma Client (v6.x.x) to ./node_modules/@prisma/client in 123ms
```

---

## Step 4: Verify Migration Succeeded

```bash
# Open Prisma Studio to inspect your database
npx prisma studio

# Or query directly:
mysql -u kourify -p kourify_dev
SHOW TABLES;
DESCRIBE Session;
DESCRIBE ProtectionClaim;
EXIT;
```

---

## Step 5: (Optional) Migrate Existing Data from SQLite

If you have existing claims/sessions from SQLite, you can migrate them:

```bash
# Export SQLite data to JSON
sqlite3 dev.sqlite ".mode json" "SELECT * FROM ProtectionClaim;" > claims.json
sqlite3 dev.sqlite ".mode json" "SELECT * FROM Session;" > sessions.json

# Create a migration script:
npm install csv-parse dotenv
```

Create `scripts/migrate-from-sqlite.ts`:
```typescript
import fs from 'fs';
import prisma from './app/db.server';

async function migrateData() {
  try {
    const claims = JSON.parse(fs.readFileSync('claims.json', 'utf-8'));
    const sessions = JSON.parse(fs.readFileSync('sessions.json', 'utf-8'));

    // Insert sessions
    for (const session of sessions) {
      await prisma.session.upsert({
        where: { id: session.id },
        update: session,
        create: session,
      });
    }

    // Insert claims
    for (const claim of claims) {
      await prisma.protectionClaim.create({
        data: claim,
      });
    }

    console.log(`✅ Migrated ${sessions.length} sessions and ${claims.length} claims`);
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

migrateData();
```

Run it:
```bash
npx ts-node scripts/migrate-from-sqlite.ts
```

---

## Step 6: Update Production Deployment

### If using Vercel/Netlify:
1. Add `DATABASE_URL` to environment variables
2. Redeploy
3. In build logs, you should see:
   ```
   Prisma schema loaded from prisma/schema.prisma
   Datasource "db": MySQL database
   ```

### If using Docker:
Update `Dockerfile`:
```dockerfile
# Build stage stays the same...

# Run migrations on startup
RUN npm run setup

# Existing CMD stays the same
CMD npm run start
```

`package.json` already has:
```json
"setup": "prisma generate && prisma migrate deploy"
```

### If using manual VM/server:
```bash
# SSH into server
ssh user@production.example.com

# Pull latest code
git pull origin main

# Install dependencies
npm install

# Run migrations
npm run setup

# Restart app
systemctl restart kourify
```

---

## Step 7: Enable Backups & Monitoring

### PlanetScale Backups
- Automatic daily backups (30-day retention)
- Access via: Settings → Backups

### AWS RDS Backups
- Automatic daily backups (7-day retention by default)
- Access via: AWS Console → RDS → Backups
- Consider increasing retention to 30 days for production

### Monitor Query Performance
```bash
# In MySQL:
SHOW PROCESSLIST; -- Active queries
SHOW SLOW QUERIES; -- Slow query log

# Or via Prisma Studio:
npx prisma studio
```

---

## Step 8: Optimize for Production

### Add indexes to improve query speed:
These are already in the updated schema, but verify:
```bash
mysql kourify_prod -u admin -p
SHOW INDEX FROM ProtectionClaim;
SHOW INDEX FROM Order;
SHOW INDEX FROM AuditLog;
```

### Set up read replicas (AWS RDS):
1. RDS Console → Instances → Actions → Create Read Replica
2. Use for reporting/analytics queries to offload main DB
3. Update app to route read queries to replica:
```typescript
// app/lib/db-replica.server.ts
const replica = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_REPLICA_URL } }
});

// Use replica for read-only queries
const analytics = await replica.protectionClaim.findMany({...});
```

### Enable query logging (for debugging):
```bash
# In MySQL:
SET GLOBAL log_output = 'TABLE';
SET GLOBAL general_log = 'ON';
SELECT * FROM mysql.general_log LIMIT 10;
```

---

## Troubleshooting

### "Error: connect ECONNREFUSED 127.0.0.1:3306"
→ MySQL is not running
```bash
# Mac:
brew services start mysql

# Linux:
sudo systemctl start mysql

# Docker:
docker start kourify-mysql
```

### "Access denied for user 'kourify'@'localhost'"
→ Wrong password in `DATABASE_URL`
```bash
# Reset password:
mysql -u root -p
ALTER USER 'kourify'@'localhost' IDENTIFIED BY 'new_password';
FLUSH PRIVILEGES;
```

### "Lost connection to MySQL server during query"
→ MySQL crashed or timed out
```bash
# Check if MySQL is running:
mysql -u root -p -e "SELECT 1;"

# Increase timeout in MySQL:
# my.cnf: wait_timeout = 600 (10 minutes)
```

### "Disk quota exceeded"
→ Database is too large
```bash
# Check size:
SELECT table_name, ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb
FROM information_schema.TABLES
WHERE table_schema = 'kourify_prod'
ORDER BY (data_length + index_length) DESC;

# Clean up old claims (optional):
DELETE FROM ProtectionClaim WHERE createdAt < DATE_SUB(NOW(), INTERVAL 2 YEAR);
DELETE FROM AuditLog WHERE createdAt < DATE_SUB(NOW(), INTERVAL 1 YEAR);
```

---

## Connection String Examples by Host

| Host | Connection String |
|------|-------------------|
| **Local MySQL** | `mysql://root:password@localhost:3306/kourify_dev` |
| **PlanetScale** | `mysql://user:password@aws.connect.psdb.cloud/kourify_prod?sslaccept=strict` |
| **AWS RDS** | `mysql://admin:password@kourify.xxxxx.us-east-1.rds.amazonaws.com:3306/kourify_prod` |
| **Railway** | Auto-provided in Railway dashboard |
| **Google Cloud SQL** | `mysql://user:password@cloudsql-instance.com/database` |
| **DigitalOcean** | `mysql://doadmin:password@db-xxxxx.ondigitalocean.com:25060/kourify_prod?ssl=true` |

---

## Next Steps

1. ✅ Set up MySQL (local or cloud)
2. ✅ Update `.env` with connection string
3. ✅ Run `npx prisma migrate dev --name init`
4. ✅ Test locally with `npm run dev`
5. ✅ Deploy to production
6. ✅ Monitor performance via Prisma Studio
7. ✅ Set up automated backups
8. ✅ (From CODE_REVIEW.md) Add order syncing for scaling
9. ✅ (From CODE_REVIEW.md) Implement Redis rate limiting
10. ✅ (From CODE_REVIEW.md) Add email provider integration

---

## Quick Checklist

- [ ] MySQL database created
- [ ] Connection string in `.env`
- [ ] `.env` added to `.gitignore`
- [ ] `npx prisma migrate dev --name init` succeeded
- [ ] `npx prisma studio` shows tables and data
- [ ] `npm run dev` starts without database errors
- [ ] Production `DATABASE_URL` is set in your hosting platform
- [ ] Backups are configured
- [ ] Team knows the database password (store in password manager)

---

**Questions?** See the full code review at [CODE_REVIEW.md](../CODE_REVIEW.md) for security hardening recommendations before going live.

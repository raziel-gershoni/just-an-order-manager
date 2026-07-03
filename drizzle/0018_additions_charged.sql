-- Custom SQL migration file, put your code below! --
ALTER TABLE "orders" ADD COLUMN "additions_charged" boolean DEFAULT true NOT NULL;

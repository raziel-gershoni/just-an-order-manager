-- Custom SQL migration file, put your code below! --
ALTER TABLE "order_items" ADD COLUMN "additions_charged" boolean;

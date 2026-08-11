-- Two strangers who sent /start to the staff bot and stopped there. The bot
-- creates a users row before it knows who you are, so each left a row and an
-- offer to open the manager; neither ever joined a group, created one, or was
-- invited, so nothing references them. One arrived in April, before the public
-- site existed; the other in July, when the site's "בטלגרם" hero button still
-- pointed customers at the bot. That button is gone as of this deploy.
--
-- Matched on telegram_id rather than id, and re-checked against group_members,
-- so this can't take out a real member if it ever runs against another database.
DELETE FROM "users"
WHERE "telegram_id" IN ('8792245314', '7139586934')
  AND "id" NOT IN (SELECT "user_id" FROM "group_members");

-- AI order draft (NUD-150, D26): the pasted customer message and the raw answer of the model are
-- stored WITH the order. The answer is what the office reviews (confidence per line, unmatched
-- products), the text is what it was read from. Both are optional: manual entry stores nothing.
-- AddColumn
ALTER TABLE "Order" ADD COLUMN "sourceText" TEXT,
ADD COLUMN "aiExtraction" JSONB;

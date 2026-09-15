package repository

import (
	"reflect"
	"testing"

	"cpa-usage-keeper/internal/entities"
)

func TestInsertBatchSizeUsesModelColumnCount(t *testing.T) {
	usageIdentityColumnCount := insertBatchColumnCount(entities.UsageIdentity{})
	usageIdentityBatchSize := insertBatchSize(entities.UsageIdentity{})
	if usageIdentityBatchSize >= maxRepositoryInsertBatchSize {
		t.Fatalf("expected wide usage identity model to reduce batch below %d, got %d", maxRepositoryInsertBatchSize, usageIdentityBatchSize)
	}
	if usageIdentityBatchSize != sqliteVariableLimit/usageIdentityColumnCount {
		t.Fatalf("expected usage identity batch size to use %d insert columns, got %d", usageIdentityColumnCount, usageIdentityBatchSize)
	}

	narrowBatchSize := insertBatchSize(narrowInsertBatchModel{})
	if narrowBatchSize != maxRepositoryInsertBatchSize {
		t.Fatalf("expected narrow model to keep max batch size %d, got %d", maxRepositoryInsertBatchSize, narrowBatchSize)
	}
}

type narrowInsertBatchModel struct {
	Name string
}

func TestInsertBatchSizeCachesModelColumnCount(t *testing.T) {
	insertBatchSize(entities.UsageIdentity{})
	if _, ok := insertBatchColumnCountCache.Load(reflect.TypeFor[entities.UsageIdentity]()); !ok {
		t.Fatal("expected insert batch size to cache the UsageIdentity column count")
	}
}

package test

import (
	"reflect"
	"testing"

	"cpa-usage-keeper/internal/repository/dto"
)

func TestUsageQueryFilterDoesNotExposeRawSourceFilter(t *testing.T) {
	if _, exists := reflect.TypeFor[dto.UsageQueryFilter]().FieldByName("Source"); exists {
		t.Fatal("usage queries must select identities through auth_index")
	}
}

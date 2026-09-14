package service

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestJoinAuthFilesManagementErrorDedupesContextCancellation(t *testing.T) {
	var joined error

	joined = joinAuthFilesManagementError(joined, context.Canceled)
	joined = joinAuthFilesManagementError(joined, context.Canceled)

	if !errors.Is(joined, context.Canceled) {
		t.Fatalf("expected joined error to contain context cancellation, got %v", joined)
	}
	if strings.Count(joined.Error(), context.Canceled.Error()) != 1 {
		t.Fatalf("expected context cancellation to appear once, got %q", joined.Error())
	}
}

func TestJoinAuthFilesManagementErrorReturnsFirstErrorDirectly(t *testing.T) {
	first := errors.New("first failure")

	if joined := joinAuthFilesManagementError(nil, first); joined != first {
		t.Fatalf("expected first error to be returned directly, got %T %[1]v", joined)
	}
}

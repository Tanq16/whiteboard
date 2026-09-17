package board

import (
	"cmp"
	"fmt"
	"slices"
	"strings"
	"sync"
	"uuid"
)

const (
	KindPut     = "put"
	KindDelete  = "delete"
	KindClear   = "clear"
	KindReplace = "replace"
)

const (
	historyLimit  = 512
	subscriberBuf = 64
)

type Element map[string]any

func (e Element) ID() string {
	id, _ := e["id"].(string)
	return id
}

func (e Element) Z() float64 {
	z, _ := e["z"].(float64)
	return z
}

type Op struct {
	Seq      int64     `json:"seq"`
	Origin   string    `json:"origin"`
	Kind     string    `json:"kind"`
	Elements []Element `json:"elements,omitempty"`
	IDs      []string  `json:"ids,omitempty"`
}

type Snapshot struct {
	Seq      int64     `json:"seq"`
	Elements []Element `json:"elements"`
}

type Board struct {
	mu       sync.Mutex
	epoch    string
	seq      int64
	elements []Element
	history  []Op
	subs     map[int]chan Op
	nextSub  int
}

func New() *Board {
	return &Board{epoch: uuid.New().String(), subs: make(map[int]chan Op)}
}

func (b *Board) Epoch() string {
	return b.epoch
}

func (b *Board) Apply(op Op) (Op, error) {
	if err := validate(op); err != nil {
		return Op{}, err
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	b.seq++
	op.Seq = b.seq

	switch op.Kind {
	case KindPut:
		for _, el := range op.Elements {
			b.put(el)
		}
	case KindDelete:
		b.elements = slices.DeleteFunc(b.elements, func(el Element) bool {
			return slices.Contains(op.IDs, el.ID())
		})
	case KindClear:
		b.elements = nil
	case KindReplace:
		b.elements = slices.Clone(op.Elements)
		slices.SortFunc(b.elements, compareElements)
	}

	b.history = append(b.history, op)
	if len(b.history) > historyLimit {
		b.history = slices.Delete(b.history, 0, len(b.history)-historyLimit)
	}
	b.broadcast(op)
	return op, nil
}

func (b *Board) Snapshot() Snapshot {
	b.mu.Lock()
	defer b.mu.Unlock()
	return Snapshot{Seq: b.seq, Elements: slices.Clone(b.elements)}
}

func (b *Board) Replay(epoch string, after int64) ([]Op, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if epoch != b.epoch {
		return nil, false
	}
	idx := len(b.history) - int(b.seq-after)
	if idx < 0 || idx > len(b.history) {
		return nil, false
	}
	return slices.Clone(b.history[idx:]), true
}

func (b *Board) Subscribe() (int, <-chan Op) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.nextSub++
	ch := make(chan Op, subscriberBuf)
	b.subs[b.nextSub] = ch
	return b.nextSub, ch
}

func (b *Board) Unsubscribe(id int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if ch, ok := b.subs[id]; ok {
		delete(b.subs, id)
		close(ch)
	}
}

func (b *Board) put(el Element) {
	if i := slices.IndexFunc(b.elements, func(e Element) bool { return e.ID() == el.ID() }); i >= 0 {
		b.elements[i] = el
		return
	}
	i, _ := slices.BinarySearchFunc(b.elements, el, compareElements)
	b.elements = slices.Insert(b.elements, i, el)
}

func (b *Board) broadcast(op Op) {
	for id, ch := range b.subs {
		select {
		case ch <- op:
		default:
			// A dropped subscriber reconnects and resyncs from a snapshot, so a full buffer is not fatal.
			delete(b.subs, id)
			close(ch)
		}
	}
}

func compareElements(a, b Element) int {
	if c := cmp.Compare(a.Z(), b.Z()); c != 0 {
		return c
	}
	return strings.Compare(a.ID(), b.ID())
}

func validate(op Op) error {
	if op.Origin == "" {
		return fmt.Errorf("op carries no origin")
	}
	switch op.Kind {
	case KindPut:
		if len(op.Elements) == 0 {
			return fmt.Errorf("put op carries no elements")
		}
		fallthrough
	case KindReplace:
		for _, el := range op.Elements {
			if el.ID() == "" {
				return fmt.Errorf("%s op carries an element with no id", op.Kind)
			}
		}
	case KindDelete:
		if len(op.IDs) == 0 {
			return fmt.Errorf("delete op carries no ids")
		}
	case KindClear:
	default:
		return fmt.Errorf("unknown op kind %q", op.Kind)
	}
	return nil
}

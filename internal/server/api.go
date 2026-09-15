package server

import (
	"encoding/json/v2"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Tanq16/whiteboard/internal/board"
	"github.com/rs/zerolog/log"
)

const heartbeatInterval = 25 * time.Second

func (s *Server) handleOps(w http.ResponseWriter, r *http.Request) {
	var op board.Op
	if err := json.UnmarshalRead(r.Body, &op); err != nil {
		log.Error().Err(err).Msg("failed to decode op")
		http.Error(w, "malformed op", http.StatusBadRequest)
		return
	}
	applied, err := s.board.Apply(op)
	if err != nil {
		log.Error().Err(err).Str("kind", op.Kind).Msg("failed to apply op")
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	log.Debug().Int64("seq", applied.Seq).Str("kind", applied.Kind).Str("origin", applied.Origin).Msg("op applied")
	w.Header().Set("Content-Type", "application/json")
	if err := json.MarshalWrite(w, map[string]int64{"seq": applied.Seq}); err != nil {
		log.Error().Err(err).Msg("failed to write op response")
	}
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")

	rc := http.NewResponseController(w)
	id, ops := s.board.Subscribe()
	defer s.board.Unsubscribe(id)

	if err := s.writeCatchUp(w, r); err != nil {
		log.Debug().Err(err).Msg("stream closed before catch-up completed")
		return
	}
	if err := rc.Flush(); err != nil {
		return
	}
	log.Debug().Int("subscriber", id).Msg("stream opened")

	heartbeat := time.Tick(heartbeatInterval)
	for {
		select {
		case <-r.Context().Done():
			return
		case op, ok := <-ops:
			if !ok {
				return
			}
			if err := s.writeEvent(w, op.Seq, "op", op); err != nil {
				return
			}
		case <-heartbeat:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
		}
		if err := rc.Flush(); err != nil {
			return
		}
	}
}

func (s *Server) writeCatchUp(w http.ResponseWriter, r *http.Request) error {
	epoch, seq, found := strings.Cut(r.Header.Get("Last-Event-ID"), ":")
	if found {
		if last, err := strconv.ParseInt(seq, 10, 64); err == nil {
			if missed, ok := s.board.Replay(epoch, last); ok {
				for _, op := range missed {
					if err := s.writeEvent(w, op.Seq, "op", op); err != nil {
						return err
					}
				}
				return nil
			}
		}
	}
	snapshot := s.board.Snapshot()
	return s.writeEvent(w, snapshot.Seq, "sync", snapshot)
}

func (s *Server) writeEvent(w http.ResponseWriter, seq int64, name string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	// The epoch in the id is what makes a client resuming against a restarted server resync instead of replaying.
	_, err = fmt.Fprintf(w, "id: %s:%d\nevent: %s\ndata: %s\n\n", s.board.Epoch(), seq, name, data)
	return err
}

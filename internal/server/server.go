package server

import (
	"embed"
	"fmt"
	"io/fs"
	"net/http"

	"github.com/Tanq16/whiteboard/internal/board"
	"github.com/rs/zerolog/log"
)

//go:embed static
var staticFiles embed.FS

type Server struct {
	host  string
	port  int
	mux   *http.ServeMux
	board *board.Board
}

func New(host string, port int) *Server {
	return &Server{
		host:  host,
		port:  port,
		mux:   http.NewServeMux(),
		board: board.New(),
	}
}

func (s *Server) Setup() error {
	staticFS, err := fs.Sub(staticFiles, "static")
	if err != nil {
		return err
	}
	s.mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.FS(staticFS))))
	s.mux.HandleFunc("/sw.js", s.handleServiceWorker)
	s.mux.HandleFunc("/api/health", s.handleHealth)
	s.mux.HandleFunc("GET /api/events", s.handleEvents)
	s.mux.HandleFunc("POST /api/ops", s.handleOps)
	s.mux.HandleFunc("/", s.handleIndex)
	return nil
}

func (s *Server) Run() error {
	addr := fmt.Sprintf("%s:%d", s.host, s.port)
	log.Info().Str("addr", addr).Msg("starting")
	return http.ListenAndServe(addr, s.mux)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}

func (s *Server) handleServiceWorker(w http.ResponseWriter, r *http.Request) {
	data, err := staticFiles.ReadFile("static/sw.js")
	if err != nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/javascript")
	w.Write(data)
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	data, err := staticFiles.ReadFile("static/index.html")
	if err != nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html")
	w.Write(data)
}

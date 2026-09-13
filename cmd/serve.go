package cmd

import (
	"github.com/rs/zerolog/log"
	"github.com/spf13/cobra"
	"github.com/Tanq16/whiteboard/internal/server"
)

var serveFlags struct {
	host string
	port int
}

func runServe() {
	srv := server.New(serveFlags.host, serveFlags.port)
	if err := srv.Setup(); err != nil {
		log.Fatal().Err(err).Msg("failed to set up server")
	}
	if err := srv.Run(); err != nil {
		log.Fatal().Err(err).Msg("server error")
	}
}

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start the web server",
	Run: func(cmd *cobra.Command, args []string) {
		runServe()
	},
}

func init() {
	serveCmd.Flags().StringVarP(&serveFlags.host, "host", "H", "0.0.0.0", "Host to bind to")
	serveCmd.Flags().IntVarP(&serveFlags.port, "port", "p", 8080, "Port to listen on")
}

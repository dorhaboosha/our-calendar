-- Runs once, when the data volume is first created.
-- A separate database for integration tests, so tests never touch development data.
CREATE DATABASE our_calendar_test;

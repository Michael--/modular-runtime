cmake_minimum_required(VERSION 3.21)
project(event_pipeline_monolith LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(event-pipeline-monolith
  src/main.cpp
  src/coordinator.cpp
  src/metrics.cpp
  src/threads/reader.cpp
  src/threads/parser.cpp
  src/threads/rules.cpp
  src/threads/aggregator.cpp
  src/threads/writer.cpp
)

target_include_directories(event-pipeline-monolith
  PRIVATE
    ${CMAKE_CURRENT_LIST_DIR}/src
)

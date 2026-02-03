cmake_minimum_required(VERSION 3.18)
project(calculator_client_cpp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(gRPC CONFIG REQUIRED)

set(PROTO_ROOT ${CMAKE_CURRENT_LIST_DIR}/../../packages/proto)
set(GENERATED_DIR ${CMAKE_CURRENT_BINARY_DIR}/generated)

set(PROTO_FILES
  ${PROTO_ROOT}/broker/v1/broker.proto
  ${PROTO_ROOT}/calculator/v1/calculator.proto
)

file(MAKE_DIRECTORY ${GENERATED_DIR})

set(GENERATED_SRCS)
set(GENERATED_HDRS)

foreach(PROTO_FILE ${PROTO_FILES})
  file(RELATIVE_PATH PROTO_REL ${PROTO_ROOT} ${PROTO_FILE})
  get_filename_component(PROTO_DIR ${PROTO_REL} DIRECTORY)
  get_filename_component(PROTO_NAME ${PROTO_FILE} NAME_WE)

  set(PB_CC ${GENERATED_DIR}/${PROTO_DIR}/${PROTO_NAME}.pb.cc)
  set(PB_H ${GENERATED_DIR}/${PROTO_DIR}/${PROTO_NAME}.pb.h)
  set(GRPC_CC ${GENERATED_DIR}/${PROTO_DIR}/${PROTO_NAME}.grpc.pb.cc)
  set(GRPC_H ${GENERATED_DIR}/${PROTO_DIR}/${PROTO_NAME}.grpc.pb.h)

  add_custom_command(
    OUTPUT ${PB_CC} ${PB_H} ${GRPC_CC} ${GRPC_H}
    COMMAND $<TARGET_FILE:protobuf::protoc>
      --proto_path=${PROTO_ROOT}
      --cpp_out=${GENERATED_DIR}
      --grpc_out=${GENERATED_DIR}
      --plugin=protoc-gen-grpc=$<TARGET_FILE:gRPC::grpc_cpp_plugin>
      ${PROTO_REL}
    DEPENDS ${PROTO_FILE}
    COMMENT "Generating C++ sources for ${PROTO_REL}"
    VERBATIM
  )

  list(APPEND GENERATED_SRCS ${PB_CC} ${GRPC_CC})
  list(APPEND GENERATED_HDRS ${PB_H} ${GRPC_H})
endforeach()

add_executable(calculator-client-cpp
  src/main.cpp
  ${GENERATED_SRCS}
  ${GENERATED_HDRS}
)

target_include_directories(calculator-client-cpp
  PRIVATE
    ${GENERATED_DIR}
)

find_package(CURL REQUIRED)

target_link_libraries(calculator-client-cpp
  PRIVATE
    gRPC::grpc++
    CURL::libcurl
)

# Generated Cmake Pico project file

cmake_minimum_required(VERSION 3.13)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Initialise pico_sdk from installed location
# (note this can come from environment, CMake cache etc)

# == DO NOT EDIT THE FOLLOWING LINES for the Raspberry Pi Pico VS Code Extension to work ==
if(WIN32)
    set(USERHOME $ENV{USERPROFILE})
else()
    set(USERHOME $ENV{HOME})
endif()
set(sdkVersion 2.3.1)
set(toolchainVersion 15_2_Rel1)
set(picotoolVersion 2.3.1)
set(picoVscode ${USERHOME}/.pico-sdk/cmake/pico-vscode.cmake)
if (EXISTS ${picoVscode})
    include(${picoVscode})
endif()
# ====================================================================================
set(PICO_BOARD pico_w CACHE STRING "Board type")

# Pull in Raspberry Pi Pico SDK (must be before project)
include(pico_sdk_import.cmake)

project(sandpfwocm C CXX ASM)

# Initialise the Raspberry Pi Pico SDK
pico_sdk_init()

# Add executable. Default name is the project name, version 0.1

add_executable(sandpfwocm sandpfwocm.c usb_descriptors.c)

pico_set_program_name(sandpfwocm "sandpfwocm")
pico_set_program_version(sandpfwocm "0.1")

# Disable SDK stdio — we use our own TinyUSB CDC descriptor for serial output
pico_enable_stdio_uart(sandpfwocm 0)
pico_enable_stdio_usb(sandpfwocm 0)

# Add the standard library to the build
target_link_libraries(sandpfwocm
        tinyusb_device
        tinyusb_board
        pico_stdlib)

# Add the standard include files to the build
target_include_directories(sandpfwocm PRIVATE
        ${CMAKE_CURRENT_LIST_DIR}
)

# Add any user requested libraries
target_link_libraries(sandpfwocm 
        
        )

pico_add_extra_outputs(sandpfwocm)

